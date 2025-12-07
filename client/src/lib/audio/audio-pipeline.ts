import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

export interface NoiseSuppressedStream {
  stream: MediaStream;
  audioContext: AudioContext;
  workletNode: RnnoiseWorkletNode | null;
  sourceNode: MediaStreamAudioSourceNode;
  destinationNode: MediaStreamAudioDestinationNode;
  isNoiseCancellationEnabled: boolean;
  cleanup: () => void;
}

let rnnoiseWasmBinary: ArrayBuffer | null = null;
const registeredContexts = new WeakSet<AudioContext>();

async function loadRnnoiseWasm(): Promise<ArrayBuffer> {
  if (rnnoiseWasmBinary) {
    return rnnoiseWasmBinary;
  }
  
  console.log('[NoiseSuppression] Loading RNNoise WASM binary...');
  rnnoiseWasmBinary = await loadRnnoise({ 
    url: rnnoiseWasmPath,
    simdUrl: rnnoiseSimdWasmPath
  });
  console.log('[NoiseSuppression] RNNoise WASM loaded successfully');
  return rnnoiseWasmBinary;
}

async function registerWorklet(audioContext: AudioContext): Promise<void> {
  if (audioContext.state === 'closed') {
    throw new Error('Cannot register worklet on closed AudioContext');
  }
  
  if (registeredContexts.has(audioContext)) {
    return;
  }
  
  console.log('[NoiseSuppression] Registering AudioWorklet module...');
  await audioContext.audioWorklet.addModule(rnnoiseWorkletPath);
  registeredContexts.add(audioContext);
  console.log('[NoiseSuppression] AudioWorklet registered successfully');
}

export function isNoiseCancellationSupported(): boolean {
  return typeof AudioWorkletNode !== 'undefined' && 
         typeof AudioContext !== 'undefined' &&
         typeof WebAssembly !== 'undefined';
}

export async function createNoiseSuppressedStream(
  rawStream: MediaStream
): Promise<NoiseSuppressedStream> {
  const audioTracks = rawStream.getAudioTracks();
  
  if (audioTracks.length === 0) {
    throw new Error('No audio tracks found in the stream');
  }

  if (!isNoiseCancellationSupported()) {
    console.warn('[NoiseSuppression] AudioWorklet not supported, using raw stream');
    return {
      stream: rawStream,
      audioContext: null as any,
      workletNode: null,
      sourceNode: null as any,
      destinationNode: null as any,
      isNoiseCancellationEnabled: false,
      cleanup: () => {}
    };
  }

  try {
    const audioContext = new AudioContext({ sampleRate: 48000 });
    
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    await registerWorklet(audioContext);
    const wasmBinary = await loadRnnoiseWasm();

    const sourceNode = audioContext.createMediaStreamSource(rawStream);
    const destinationNode = audioContext.createMediaStreamDestination();

    const rnnoiseNode = new RnnoiseWorkletNode(audioContext, {
      wasmBinary,
      maxChannels: 1
    });

    sourceNode.connect(rnnoiseNode);
    rnnoiseNode.connect(destinationNode);

    const processedStream = destinationNode.stream;
    
    const videoTracks = rawStream.getVideoTracks();
    videoTracks.forEach(track => {
      processedStream.addTrack(track);
    });

    console.log('[NoiseSuppression] Noise suppression pipeline created successfully');

    const cleanup = () => {
      console.log('[NoiseSuppression] Cleaning up audio pipeline...');
      try {
        sourceNode.disconnect();
        rnnoiseNode.disconnect();
        rnnoiseNode.destroy();
        
        if (audioContext.state !== 'closed') {
          audioContext.close();
        }
      } catch (err) {
        console.warn('[NoiseSuppression] Cleanup error:', err);
      }
    };

    return {
      stream: processedStream,
      audioContext,
      workletNode: rnnoiseNode,
      sourceNode,
      destinationNode,
      isNoiseCancellationEnabled: true,
      cleanup
    };
  } catch (error) {
    console.error('[NoiseSuppression] Failed to create noise suppression pipeline:', error);
    console.warn('[NoiseSuppression] Falling back to raw stream');
    
    return {
      stream: rawStream,
      audioContext: null as any,
      workletNode: null,
      sourceNode: null as any,
      destinationNode: null as any,
      isNoiseCancellationEnabled: false,
      cleanup: () => {}
    };
  }
}

export function resetWorkletRegistration(): void {
  // WeakSet automatically handles cleanup when AudioContexts are garbage collected
  // This function is kept for backward compatibility but is now a no-op
}
