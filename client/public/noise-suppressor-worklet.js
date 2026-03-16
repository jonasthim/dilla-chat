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

    this.port.onmessage = (e) => {
      if (e.data.type === 'enable') {
        this._enabled = e.data.enabled;
      }
    };

    this._init();
  }

  async _init() {
    try {
      // Import the rnnoise WASM module from the public directory
      const { default: createModule } = await import('/rnnoise/rnnoise.js');
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

    // RNNoise expects values in [-32768, 32767] (PCM16 range)
    const pcmInput = new Float32Array(FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i++) {
      pcmInput[i] = this._inputBuffer[i] * 32768;
    }

    // Copy to WASM heap
    m.HEAPF32.set(pcmInput, this._heapInput >> 2);

    // Process frame
    m._rnnoise_process_frame(this._state, this._heapOutput >> 2, this._heapInput >> 2);

    // Read output and convert back to [-1, 1]
    const pcmOutput = m.HEAPF32.subarray(
      this._heapOutput >> 2,
      (this._heapOutput >> 2) + FRAME_SIZE,
    );

    for (let i = 0; i < FRAME_SIZE; i++) {
      this._outputBuffer[i] = pcmOutput[i] / 32768;
    }

    this._outputOffset = 0;
    this._outputAvailable = FRAME_SIZE;
  }
}

registerProcessor('noise-suppressor', NoiseSuppressorProcessor);
