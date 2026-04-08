// Shared types for the voice isolation pipeline.
//
// The pipeline runs DeepFilterNet 3 (DFN3) inference in a dedicated Worker
// fed by an AudioWorklet via a SharedArrayBuffer ring buffer. DFN3 ships
// as three ONNX sub-graphs (encoder, ERB-band gain decoder, deep-filter
// coefficient decoder) that the Worker hosts as separate ORT sessions.

export type ModelKind = 'dfn3' | 'passthrough';

/** Returned by the Worker after the three DFN3 sub-graphs are loaded. */
export interface ModelHandle {
  kind: 'dfn3';
  version: number;
  /** ORT session ids — one per sub-graph. */
  encoderSessionId: string;
  erbDecoderSessionId: string;
  dfDecoderSessionId: string;
}

/**
 * DFN3 hyperparameters mirrored from the upstream config.ini.
 *
 * `lookaheadFrames` is the sum of conv-lookahead (2) and DF-lookahead (2),
 * giving a total algorithmic delay of `lookaheadFrames * (hopSize / sampleRate) * 1000`
 * = 4 * 10 = 40 ms.
 */
export interface Dfn3ModelIOSpec {
  encoder: {
    inputs: readonly ['feat_erb', 'feat_spec'];
    outputs: readonly ['e0', 'e1', 'e2', 'e3', 'emb', 'c0', 'lsnr'];
  };
  erbDecoder: { outputs: readonly ['m'] };
  dfDecoder: { outputs: readonly ['coefs'] };
  sampleRate: 48000;
  fftSize: 960;
  hopSize: 480;
  nbErb: 32;
  nbDf: 96;
  dfOrder: 5;
  lookaheadFrames: 4;
}

export interface PerStreamStats {
  framesProcessed: number;
  framesDropped: number;
  medianFrameMs: number;
}

export interface CallState {
  enabled: boolean;
  modelLoaded: boolean;
  outgoingStream: PerStreamStats | null;
  incomingStreams: Map<string, PerStreamStats>;
  cpuDegradeActive: boolean;
}
