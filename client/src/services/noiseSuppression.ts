/**
 * Noise suppression service.
 *
 * Loads an AudioWorklet running RNNoise (via @jitsi/rnnoise-wasm) and exposes
 * the worklet node so callers can wire it into their own audio graph.
 *
 * Works in both the browser and Tauri webview (both support AudioWorklet).
 */

import { useAudioSettingsStore } from '../stores/audioSettingsStore';

const WORKLET_URL = '/noise-suppressor-worklet.js';

export class NoiseSuppression {
  private workletNode: AudioWorkletNode | null = null;
  private enabled = true;
  private initialized = false;
  private storeUnsubscribe: (() => void) | null = null;

  /**
   * Load the RNNoise worklet module into the given AudioContext and create
   * the worklet node. The caller owns the AudioContext and wires the node
   * into its own graph via getWorkletNode().
   */
  async initWorklet(audioContext: AudioContext): Promise<void> {
    await audioContext.audioWorklet.addModule(WORKLET_URL);

    this.workletNode = new AudioWorkletNode(audioContext, 'noise-suppressor');

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

    console.log('[NoiseSuppression] AudioWorklet node created');
  }

  /** Returns the worklet node for the caller to wire into its audio graph. */
  getWorkletNode(): AudioWorkletNode | null {
    return this.workletNode;
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

  /** Wait for the RNNoise worklet to post 'ready' (with timeout). */
  waitForReady(timeoutMs = 3000): Promise<boolean> {
    if (this.initialized) return Promise.resolve(true);
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (this.initialized) {
          clearInterval(interval);
          resolve(true);
        }
      }, 50);
      setTimeout(() => {
        clearInterval(interval);
        resolve(this.initialized);
      }, timeoutMs);
    });
  }

  /** Tear down the worklet node and store subscription. Caller owns the AudioContext. */
  cleanup(): void {
    if (this.storeUnsubscribe) {
      this.storeUnsubscribe();
      this.storeUnsubscribe = null;
    }
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    this.initialized = false;
  }
}

// Singleton — preserved across HMR
const globalKey = '__dilla_noiseSuppression__';
const _nsGlobal = globalThis as Record<string, unknown>;
if (!_nsGlobal[globalKey]) {
  _nsGlobal[globalKey] = new NoiseSuppression();
}
export const noiseSuppression: NoiseSuppression = _nsGlobal[globalKey] as NoiseSuppression;
