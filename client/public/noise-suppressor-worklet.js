/**
 * AudioWorklet processor for RNNoise-based noise suppression.
 *
 * Loads the @jitsi/rnnoise-wasm module (served from /rnnoise/)
 * and processes 480-sample frames at 48 kHz (10 ms per frame).
 * AudioWorklet delivers 128 samples per render quantum, so we
 * accumulate into a ring buffer and output denoised audio once
 * a full frame is available.
 */

const FRAME_SIZE = 480; // RNNoise frame size (48 kHz × 10 ms)
const SAMPLE_RATE = 48000;

class NoiseSuppressorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this._enabled = true;
    this._ready = false;
    this._module = null;
    this._state = null;
    this._heapInput = null;
    this._heapOutput = null;
    this._inputBuffer = new Float32Array(FRAME_SIZE);
    this._outputBuffer = new Float32Array(FRAME_SIZE);
    this._inputOffset = 0;
    this._outputOffset = 0;
    this._outputAvailable = 0;

    // VAD gating state
    this._vadThreshold = 0.5;
    this._graceSamplesRemaining = 0;
    this._gracePeriodMs = 200;
    this._retroactiveGraceMs = 20;
    this._speechActive = false;

    // Retroactive grace: circular buffer of raw input frames
    this._retroBufferSize = Math.ceil(this._retroactiveGraceMs / 10);
    this._retroBuffer = [];
    this._retroBufferIndex = 0;
    this._retroPending = false;
    this._initializing = false;

    this.port.onmessage = (e) => {
      if (e.data.type === 'enable') {
        this._enabled = e.data.enabled;
      } else if (e.data.type === 'vadThreshold') {
        this._vadThreshold = e.data.value;
      } else if (e.data.type === 'vadGracePeriodMs') {
        this._gracePeriodMs = e.data.value;
      } else if (e.data.type === 'retroactiveGraceMs') {
        this._retroactiveGraceMs = e.data.value;
        this._retroBufferSize = Math.ceil(this._retroactiveGraceMs / 10);
        // Trim buffer if new size is smaller
        while (this._retroBuffer.length > this._retroBufferSize) {
          this._retroBuffer.shift();
        }
        this._retroBufferIndex = this._retroBuffer.length % (this._retroBufferSize || 1);
      }
    };
  }

  async _init() {
    try {
      // Import the rnnoise WASM module from the public directory
      const { default: createModule } = await import('./rnnoise/rnnoise.js');
      this._module = await createModule({
        locateFile: (file) => `/rnnoise/${file}`,
      });

      const m = this._module;

      // Allocate heap memory for input/output buffers
      const bytesPerFrame = FRAME_SIZE * 4; // Float32 = 4 bytes
      this._heapInput = m._malloc(bytesPerFrame);
      this._heapOutput = m._malloc(bytesPerFrame);

      // Create RNNoise state
      this._state = m._rnnoise_create(0);

      this._ready = true;
      this.port.postMessage({ type: 'ready' });
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String(err) });
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];

    if (!input || !output) return true;

    // Lazily initialize on first process() call (avoids async work in constructor)
    if (!this._ready && !this._initializing) {
      this._initializing = true;
      this._init();
    }

    // If not ready or disabled, pass through
    if (!this._ready || !this._enabled) {
      output.set(input);
      return true;
    }

    // Feed input samples into accumulation buffer
    for (let i = 0; i < input.length; i++) {
      this._inputBuffer[this._inputOffset++] = input[i];

      if (this._inputOffset === FRAME_SIZE) {
        this._processFrame();
        this._inputOffset = 0;

        // Retroactive grace: if speech just started, prepend buffered frames
        if (this._retroPending) {
          this._retroPending = false;
          // Reorder circular buffer so oldest is first
          const buf = this._retroBuffer;
          const idx = this._retroBufferIndex;
          const ordered = buf.length === this._retroBufferSize
            ? [...buf.slice(idx), ...buf.slice(0, idx)]
            : buf.slice(0);
          // Prepend retroactive frames before current output
          // We merge them into a single expanded output
          const retroSamples = ordered.length * FRAME_SIZE;
          const merged = new Float32Array(retroSamples + FRAME_SIZE);
          for (let r = 0; r < ordered.length; r++) {
            merged.set(ordered[r], r * FRAME_SIZE);
          }
          merged.set(this._outputBuffer.subarray(0, FRAME_SIZE), retroSamples);
          // Replace output buffer with merged content
          this._outputBuffer = merged;
          this._outputOffset = 0;
          this._outputAvailable = merged.length;
          // Clear retroactive buffer
          this._retroBuffer = [];
          this._retroBufferIndex = 0;
        }
      }
    }

    // Write output from the processed buffer
    for (let i = 0; i < output.length; i++) {
      if (this._outputAvailable > 0) {
        output[i] = this._outputBuffer[this._outputOffset++];
        this._outputAvailable--;
        if (this._outputOffset >= FRAME_SIZE) {
          this._outputOffset = 0;
        }
      } else {
        // Not enough processed samples yet — output silence
        output[i] = 0;
      }
    }

    return true;
  }

  _processFrame() {
    const m = this._module;

    // Save raw input into retroactive grace buffer before processing
    if (this._retroBufferSize > 0) {
      const rawCopy = new Float32Array(FRAME_SIZE);
      rawCopy.set(this._inputBuffer);
      if (this._retroBuffer.length < this._retroBufferSize) {
        this._retroBuffer.push(rawCopy);
      } else {
        this._retroBuffer[this._retroBufferIndex] = rawCopy;
      }
      this._retroBufferIndex = (this._retroBufferIndex + 1) % this._retroBufferSize;
    }

    // RNNoise expects values in [-32768, 32767] (PCM16 range)
    const pcmInput = new Float32Array(FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i++) {
      pcmInput[i] = this._inputBuffer[i] * 32768;
    }

    // Copy to WASM heap
    m.HEAPF32.set(pcmInput, this._heapInput >> 2);

    // Process frame — return value is VAD probability [0, 1]
    const vadProb = m._rnnoise_process_frame(this._state, this._heapOutput >> 2, this._heapInput >> 2);

    // Read denoised output and convert back to [-1, 1]
    const pcmOutput = m.HEAPF32.subarray(
      this._heapOutput >> 2,
      (this._heapOutput >> 2) + FRAME_SIZE,
    );

    const wasSpeechActive = this._speechActive;
    const isSpeech = vadProb >= this._vadThreshold;

    if (isSpeech) {
      // Speech detected — reset grace timer
      this._speechActive = true;
      this._graceSamplesRemaining = Math.round(this._gracePeriodMs * (SAMPLE_RATE / 1000));
    } else {
      // No speech — decrement grace period
      if (this._graceSamplesRemaining > 0) {
        this._graceSamplesRemaining -= FRAME_SIZE;
      }
      if (this._graceSamplesRemaining <= 0) {
        this._speechActive = false;
        this._graceSamplesRemaining = 0;
      }
    }

    const passAudio = isSpeech || this._graceSamplesRemaining > 0;

    // Handle retroactive grace: speech OFF → ON transition
    if (isSpeech && !wasSpeechActive && this._retroBuffer.length > 0) {
      this._retroPending = true;
    }

    if (passAudio) {
      for (let i = 0; i < FRAME_SIZE; i++) {
        this._outputBuffer[i] = pcmOutput[i] / 32768;
      }
    } else {
      // Gate: silence the output
      for (let i = 0; i < FRAME_SIZE; i++) {
        this._outputBuffer[i] = 0;
      }
    }

    this._outputOffset = 0;
    this._outputAvailable = FRAME_SIZE;
  }
}

registerProcessor('noise-suppressor', NoiseSuppressorProcessor);
