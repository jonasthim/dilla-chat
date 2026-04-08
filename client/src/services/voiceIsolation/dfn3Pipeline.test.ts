import { describe, it, expect } from 'vitest';
import {
  DFN3_HYPERPARAMS,
  Dfn3Pipeline,
  type Dfn3InferenceBackend,
  type EncoderInputs,
  type EncoderOutputs,
  type ErbDecoderInputs,
  type ErbDecoderOutputs,
  type DfDecoderInputs,
  type DfDecoderOutputs,
} from './dfn3Pipeline';

/** A backend that passes the spectrum through unchanged: ones for the ERB
 * gain, zeros for the deep-filter coefficients. */
class PassthroughBackend implements Dfn3InferenceBackend {
  encCalls = 0;
  erbCalls = 0;
  dfCalls = 0;
  lastFeatErb?: Float32Array;
  lastFeatSpec?: Float32Array;

  async runEncoder(inputs: EncoderInputs): Promise<EncoderOutputs> {
    this.encCalls += 1;
    this.lastFeatErb = new Float32Array(inputs.featErb);
    this.lastFeatSpec = new Float32Array(inputs.featSpec);
    // Shapes per the spike memo Dfn3ModelIOSpec.
    return {
      e0: new Float32Array(1 * 64 * 1 * 32),
      e1: new Float32Array(1 * 64 * 1 * 16),
      e2: new Float32Array(1 * 64 * 1 * 8),
      e3: new Float32Array(1 * 64 * 1 * 8),
      emb: new Float32Array(1 * 1 * 512),
      c0: new Float32Array(1 * 64 * 1 * 96),
      lsnr: new Float32Array([10]),
    };
  }

  async runErbDecoder(_inputs: ErbDecoderInputs): Promise<ErbDecoderOutputs> {
    this.erbCalls += 1;
    // All-ones gain → spectrogram unchanged after applyInterpBandGain.
    return { m: new Float32Array(DFN3_HYPERPARAMS.nbErb).fill(1) };
  }

  async runDfDecoder(_inputs: DfDecoderInputs): Promise<DfDecoderOutputs> {
    this.dfCalls += 1;
    // All-zero coefs → applyDeepFilter zeroes the lowest nb_df bins.
    // For a true passthrough we'd want a delta-at-(dfOrder-1) impulse, see
    // separate test below.
    return {
      coefs: new Float32Array(DFN3_HYPERPARAMS.nbDf * DFN3_HYPERPARAMS.dfOrder * 2),
    };
  }
}

/** Backend that returns ERB gain = 1 and DF coefs = δ at the
 * `targetIdx` time tap so the deep filter exactly reproduces the current
 * (unfiltered) spectrogram for the lowest nb_df bins. */
class IdentityBackend implements Dfn3InferenceBackend {
  async runEncoder(_inputs: EncoderInputs): Promise<EncoderOutputs> {
    return {
      e0: new Float32Array(1 * 64 * 1 * 32),
      e1: new Float32Array(1 * 64 * 1 * 16),
      e2: new Float32Array(1 * 64 * 1 * 8),
      e3: new Float32Array(1 * 64 * 1 * 8),
      emb: new Float32Array(1 * 1 * 512),
      c0: new Float32Array(1 * 64 * 1 * 96),
      lsnr: new Float32Array([10]),
    };
  }
  async runErbDecoder(_inputs: ErbDecoderInputs): Promise<ErbDecoderOutputs> {
    return { m: new Float32Array(DFN3_HYPERPARAMS.nbErb).fill(1) };
  }
  async runDfDecoder(_inputs: DfDecoderInputs): Promise<DfDecoderOutputs> {
    // Coefs shape [nb_df, df_order] interleaved re/im. We want
    // applyDeepFilter to leave the target frame unchanged. The deep filter
    // computes out[k] = Σ_{t=0..dfOrder-1} spec[t][k] * coefs[k][t].
    // Setting coefs[k][targetTap] = (1, 0) and others = 0 picks out
    // exactly spec[targetTap][k]. The pipeline applies the gain to spec
    // frame at index `bufferLen - dfOrder` of the rolling buffer (which is
    // `targetIdx` in dfn3Pipeline.ts), and the deep-filter window is
    // `specBuffer[0..dfOrder]`. The match between the target index and the
    // df window is at tap = (targetIdx - 0) = bufferLen - dfOrder, but
    // the df window starts at index 0 so the tap that points to targetIdx
    // is `targetIdx - 0 = bufferLen - dfOrder`. With dfOrder=5 and
    // bufferLen=7 (5 + 2 lookahead), tap = 7 - 5 = 2. Wait — actually we
    // need the df-window index that *equals* targetIdx; window[t] is
    // specBuffer[t]. targetIdx is bufferLen - dfOrder, so window index t
    // such that t == bufferLen - dfOrder = 2. So set coefs[k][2] = 1.
    // The pipeline applies the gain to rollingY[dfOrder - 1] and then
    // uses rollingX[0..dfOrder] as the deep-filter window. To make the
    // deep filter exactly reproduce the noisy spectrum at the same time
    // index, we need coefs[k][dfOrder - 1] = (1, 0) (the last tap, which
    // points to rollingX[dfOrder - 1] = same time as rollingY[dfOrder - 1]).
    const nbDf = DFN3_HYPERPARAMS.nbDf;
    const dfOrder = DFN3_HYPERPARAMS.dfOrder;
    const targetTap = dfOrder - 1;
    const coefs = new Float32Array(nbDf * dfOrder * 2);
    for (let k = 0; k < nbDf; k++) {
      coefs[2 * (k * dfOrder + targetTap)] = 1; // real = 1
    }
    return { coefs };
  }
}

describe('Dfn3Pipeline', () => {
  it('runs the three sub-graphs once per frame and emits hopSize samples', async () => {
    const backend = new PassthroughBackend();
    const pipe = new Dfn3Pipeline(backend);
    const input = new Float32Array(DFN3_HYPERPARAMS.hopSize);
    for (let i = 0; i < input.length; i++) input[i] = Math.sin((i / input.length) * Math.PI * 4);
    const output = new Float32Array(DFN3_HYPERPARAMS.hopSize);
    await pipe.processFrame(input, output);
    expect(backend.encCalls).toBe(1);
    expect(backend.erbCalls).toBe(1);
    expect(backend.dfCalls).toBe(1);
    expect(output.length).toBe(DFN3_HYPERPARAMS.hopSize);
  });

  it('encoder receives feat_erb shape [nbErb] and feat_spec shape [2, nbDf]', async () => {
    const backend = new PassthroughBackend();
    const pipe = new Dfn3Pipeline(backend);
    const input = new Float32Array(DFN3_HYPERPARAMS.hopSize).fill(0.1);
    const output = new Float32Array(DFN3_HYPERPARAMS.hopSize);
    await pipe.processFrame(input, output);
    expect(backend.lastFeatErb!.length).toBe(DFN3_HYPERPARAMS.nbErb);
    expect(backend.lastFeatSpec!.length).toBe(2 * DFN3_HYPERPARAMS.nbDf);
  });

  it('with identity backend, reproduces a sinusoid input within 1e-3 RMS after the warm-up delay', async () => {
    const backend = new IdentityBackend();
    const pipe = new Dfn3Pipeline(backend);
    const numFrames = 25;
    const hop = DFN3_HYPERPARAMS.hopSize;
    const fftSize = DFN3_HYPERPARAMS.fftSize;
    const totalSamples = hop * numFrames;
    const input = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      input[i] = Math.cos((2 * Math.PI * 60 * i) / fftSize); // bin 60 = 3 kHz
    }
    const output = new Float32Array(totalSamples);
    for (let f = 0; f < numFrames; f++) {
      await pipe.processFrame(
        input.subarray(f * hop, (f + 1) * hop),
        output.subarray(f * hop, (f + 1) * hop),
      );
    }

    // Algorithmic delay = (df_order - 1) hops between input and the
    // y-buffer frame the iSTFT consumes, plus the 1-hop STFT framing
    // delay. With df_order = 5 → effective delay = (5 - 1) + 1 = 5 hops
    // = 5 * 480 samples.
    const delaySamples = (DFN3_HYPERPARAMS.dfOrder - 1 + 1) * hop;
    const skip = hop * 5; // additional warm-up
    const len = totalSamples - delaySamples - skip;
    let err = 0;
    for (let i = 0; i < len; i++) {
      const d = output[skip + delaySamples + i] - input[skip + i];
      err += d * d;
    }
    err = Math.sqrt(err / len);
    expect(err).toBeLessThan(1e-3);
  });
});
