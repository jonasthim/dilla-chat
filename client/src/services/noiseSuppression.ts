/**
 * Noise suppression service.
 *
 * Inserts an AudioWorklet node running RNNoise (via @jitsi/rnnoise-wasm)
 * between the raw microphone MediaStream and the RTCPeerConnection.
 *
 * Works in both the browser and Tauri webview (both support AudioWorklet).
 */

import { useAudioSettingsStore } from '../stores/audioSettingsStore';

const WORKLET_URL = '/noise-suppressor-worklet.js';

class NoiseSuppression {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private enabled = true;
  private initialized = false;
  private storeUnsubscribe: (() => void) | null = null;

  /**
   * Process an input MediaStream through RNNoise and return a new
   * MediaStream with suppressed audio.
   *
   * If AudioWorklet isn't available or setup fails, returns the
   * original stream unchanged (graceful fallback).
   */
  async processStream(inputStream: MediaStream): Promise<MediaStream> {
    try {
      // Create an AudioContext at 48 kHz to match RNNoise expectations
      this.audioContext = new AudioContext({ sampleRate: 48000 });

      // Load the worklet processor
      await this.audioContext.audioWorklet.addModule(WORKLET_URL);

      // Create nodes
      this.sourceNode = this.audioContext.createMediaStreamSource(inputStream);
      this.workletNode = new AudioWorkletNode(this.audioContext, 'noise-suppressor');
      this.destinationNode = this.audioContext.createMediaStreamDestination();

      // Wire up: mic → worklet → destination
      this.sourceNode.connect(this.workletNode);
      this.workletNode.connect(this.destinationNode);

      // Listen for ready/error from the worklet
      this.workletNode.port.onmessage = (e) => {
        if (e.data.type === 'ready') {
          console.log('[NoiseSuppression] RNNoise worklet ready');
          this.initialized = true;
        } else if (e.data.type === 'error') {
          console.warn('[NoiseSuppression] Worklet error:', e.data.message);
        }
      };

      // Send initial enabled state
      this.workletNode.port.postMessage({ type: 'enable', enabled: this.enabled });

      // Send initial VAD settings from store
      const { vadThreshold, vadGracePeriodMs, retroactiveGraceMs } =
        useAudioSettingsStore.getState();
      this.workletNode.port.postMessage({ type: 'vadThreshold', value: vadThreshold });
      this.workletNode.port.postMessage({ type: 'vadGracePeriodMs', value: vadGracePeriodMs });
      this.workletNode.port.postMessage({ type: 'retroactiveGraceMs', value: retroactiveGraceMs });

      // Subscribe to store changes and forward to worklet
      this.storeUnsubscribe = useAudioSettingsStore.subscribe((state, prev) => {
        if (!this.workletNode) return;
        if (state.vadThreshold !== prev.vadThreshold) {
          this.workletNode.port.postMessage({ type: 'vadThreshold', value: state.vadThreshold });
        }
        if (state.vadGracePeriodMs !== prev.vadGracePeriodMs) {
          this.workletNode.port.postMessage({
            type: 'vadGracePeriodMs',
            value: state.vadGracePeriodMs,
          });
        }
        if (state.retroactiveGraceMs !== prev.retroactiveGraceMs) {
          this.workletNode.port.postMessage({
            type: 'retroactiveGraceMs',
            value: state.retroactiveGraceMs,
          });
        }
      });

      console.log('[NoiseSuppression] AudioWorklet pipeline created');
      return this.destinationNode.stream;
    } catch (err) {
      console.warn('[NoiseSuppression] Failed to initialize, falling back to raw stream:', err);
      this.cleanup();
      return inputStream;
    }
  }

  /** Toggle noise suppression on/off without reconnecting. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'enable', enabled });
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  setVadThreshold(value: number): void {
    this.workletNode?.port.postMessage({ type: 'vadThreshold', value });
  }

  setVadGracePeriodMs(value: number): void {
    this.workletNode?.port.postMessage({ type: 'vadGracePeriodMs', value });
  }

  setRetroactiveGraceMs(value: number): void {
    this.workletNode?.port.postMessage({ type: 'retroactiveGraceMs', value });
  }

  /** Tear down the audio processing pipeline. */
  cleanup(): void {
    if (this.storeUnsubscribe) {
      this.storeUnsubscribe();
      this.storeUnsubscribe = null;
    }
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.destinationNode) {
      this.destinationNode.disconnect();
      this.destinationNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.initialized = false;
  }
}

// Singleton — preserved across HMR
const globalKey = '__dilla_noiseSuppression__';
export const noiseSuppression: NoiseSuppression =
  ((globalThis as Record<string, unknown>)[globalKey] as NoiseSuppression) ??
  (((globalThis as Record<string, unknown>)[globalKey] = new NoiseSuppression()) as NoiseSuppression);
