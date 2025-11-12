import React, { useState, useRef, useCallback } from 'react';
// FIX: Removed `LiveSession` as it is not an exported member of '@google/genai'.
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';

// --- TYPE DEFINITIONS ---
type AppState = 'IDLE' | 'CONNECTING' | 'RECORDING' | 'PROCESSING' | 'DONE' | 'ERROR';

// --- AUDIO UTILITY FUNCTIONS ---
function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

// --- SVG ICON COMPONENTS ---
const MicIcon: React.FC<React.ComponentProps<'svg'>> = (props) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 14a2 2 0 0 1-2-2V6a2 2 0 0 1 4 0v6a2 2 0 0 1-2 2Z" />
    <path d="M12 17a5 5 0 0 0 5-5h-2a3 3 0 0 1-6 0H7a5 5 0 0 0 5 5Z" />
    <path d="M12 4a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V8a4 4 0 0 0-4-4Z" />
  </svg>
);

const StopIcon: React.FC<React.ComponentProps<'svg'>> = (props) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <rect width="8" height="8" x="8" y="8" rx="1" />
  </svg>
);

const LoadingSpinner: React.FC<React.ComponentProps<'svg'>> = (props) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

// --- UI COMPONENTS ---

const StatusIndicator: React.FC<{ appState: AppState; errorMessage: string }> = ({ appState, errorMessage }) => {
  const getStatusContent = () => {
    switch (appState) {
      case 'IDLE':
        return <p>Ready to record. Click the microphone to start.</p>;
      case 'CONNECTING':
        return <div className="flex items-center space-x-2"><LoadingSpinner className="w-5 h-5 animate-spin" /><span>Establishing connection...</span></div>;
      case 'RECORDING':
        return (
          <div className="flex flex-col items-center">
            <div className="flex items-center space-x-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
              <span>Recording...</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">Max 15 minutes. Continues during silence.</p>
          </div>
        );
      case 'PROCESSING':
        return <div className="flex items-center space-x-2"><LoadingSpinner className="w-5 h-5 animate-spin" /><span>Analyzing conversation...</span></div>;
      case 'DONE':
        return <p className="text-green-400">Transcription complete.</p>;
      case 'ERROR':
        return <p className="text-red-400">Error: {errorMessage}</p>;
      default:
        return null;
    }
  };
  return <div className="text-center text-gray-400 min-h-[3.5rem] flex items-center justify-center">{getStatusContent()}</div>;
};

const TranscriptDisplay: React.FC<{ liveTranscript: string; finalTranscript: string; appState: AppState }> = ({ liveTranscript, finalTranscript, appState }) => {
  const showLive = appState === 'RECORDING' && liveTranscript;
  const showFinal = (appState === 'DONE' || appState === 'ERROR') && finalTranscript;

  return (
    <div className="w-full bg-gray-800 rounded-lg p-6 space-y-6 min-h-[300px] flex flex-col">
      {showLive && (
        <div>
          <h2 className="text-lg font-semibold text-gray-300 mb-2">Live Transcript</h2>
          <p className="text-gray-400 whitespace-pre-wrap">{liveTranscript}</p>
        </div>
      )}
      {showFinal && (
        <div className="flex-grow">
          <h2 className="text-lg font-semibold text-gray-300 mb-2">Final Transcript</h2>
          <div className="text-gray-200 whitespace-pre-wrap bg-gray-900/50 p-4 rounded-md h-full overflow-y-auto">{finalTranscript}</div>
        </div>
      )}
      {!showLive && !showFinal && (
         <div className="flex-grow flex items-center justify-center text-gray-500">
           <p>Your transcript will appear here.</p>
         </div>
      )}
    </div>
  );
};

const ControlButton: React.FC<{ appState: AppState; onStart: () => void; onStop: () => void; onReset: () => void }> = ({ appState, onStart, onStop, onReset }) => {
  const isDisabled = appState === 'CONNECTING' || appState === 'PROCESSING';
  const baseClasses = "w-20 h-20 rounded-full flex items-center justify-center text-white transition-all duration-200 ease-in-out focus:outline-none focus:ring-4 focus:ring-offset-2 focus:ring-offset-gray-900";
  const disabledClasses = "bg-gray-600 cursor-not-allowed";
  
  switch (appState) {
    case 'RECORDING':
      return <button onClick={onStop} className={`${baseClasses} bg-red-600 hover:bg-red-700 focus:ring-red-500`} aria-label="Stop recording"><StopIcon className="w-8 h-8" /></button>;
    case 'DONE':
    case 'ERROR':
      return <button onClick={onReset} className={`${baseClasses} bg-blue-600 hover:bg-blue-700 focus:ring-blue-500 text-sm font-semibold`}>Again</button>;
    case 'IDLE':
    case 'CONNECTING':
    case 'PROCESSING':
      const idleClasses = "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500";
      return (
        <button onClick={onStart} disabled={isDisabled} className={`${baseClasses} ${isDisabled ? disabledClasses : idleClasses}`} aria-label="Start recording">
          {appState === 'IDLE' ? <MicIcon className="w-8 h-8" /> : <LoadingSpinner className="w-8 h-8 animate-spin" />}
        </button>
      );
    default:
      return null;
  }
};

// --- MAIN APP COMPONENT ---

export default function App() {
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // FIX: Replaced `LiveSession` with `any` because it is not an exported type.
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const liveTranscriptAccumulatorRef = useRef('');
  const recordingTimeoutRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    scriptProcessorRef.current?.disconnect();
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.error);
    }
    sessionPromiseRef.current?.then(session => session.close()).catch(console.error);
    
    mediaStreamRef.current = null;
    scriptProcessorRef.current = null;
    audioContextRef.current = null;
    sessionPromiseRef.current = null;
  }, []);

  const handleError = useCallback((error: any) => {
    console.error(error);
    const message = error.message || 'An unknown error occurred.';
    setErrorMessage(message);
    setAppState('ERROR');
    setFinalTranscript(liveTranscriptAccumulatorRef.current);
    cleanup();
  }, [cleanup]);
  
  const handleStopRecording = useCallback(async () => {
    if (appState !== 'RECORDING') return;

    // Clear the auto-stop timer if it exists (for manual stops)
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    
    setAppState('PROCESSING');
    cleanup();

    const rawTranscript = liveTranscriptAccumulatorRef.current;
    if (!rawTranscript.trim()) {
      setFinalTranscript("No speech was detected.");
      setAppState('DONE');
      return;
    }
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `You are an expert in analyzing conversations. Your task is to process a raw transcript and add speaker labels (e.g., "Speaker 1", "Speaker 2"). Analyze the content and speech patterns to distinguish between different people talking. Ensure the output is clean and readable.

Here is the transcript:
---
${rawTranscript}
---

Please provide the rewritten transcript with speaker labels.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: prompt
      });

      setFinalTranscript(response.text);
      setAppState('DONE');
    } catch (error) {
      handleError(error);
    }
  }, [appState, cleanup, handleError]);

  const handleStartRecording = async () => {
    if (appState !== 'IDLE' && appState !== 'DONE' && appState !== 'ERROR') return;
    setAppState('CONNECTING');
    setLiveTranscript('');
    setFinalTranscript('');
    setErrorMessage('');
    liveTranscriptAccumulatorRef.current = '';

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: async () => {
            setAppState('RECORDING');

            // Set a 15-minute timeout to automatically stop recording
            recordingTimeoutRef.current = window.setTimeout(() => {
              handleStopRecording();
            }, 15 * 60 * 1000); // 15 minutes in milliseconds

            try {
              mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
              // FIX: Cast `window` to `any` to access vendor-prefixed `webkitAudioContext` for cross-browser compatibility.
              const context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
              audioContextRef.current = context;
              const source = context.createMediaStreamSource(mediaStreamRef.current);
              const processor = context.createScriptProcessor(4096, 1, 1);
              scriptProcessorRef.current = processor;
              
              processor.onaudioprocess = (audioProcessingEvent) => {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                const pcmBlob = createBlob(inputData);
                sessionPromiseRef.current?.then(session => {
                  session.sendRealtimeInput({ media: pcmBlob });
                }).catch(handleError);
              };

              source.connect(processor);
              processor.connect(context.destination);
            } catch (err) {
              handleError(new Error('Microphone access denied or not available.'));
            }
          },
          onmessage: (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              liveTranscriptAccumulatorRef.current += text;
              setLiveTranscript(liveTranscriptAccumulatorRef.current);
            }
          },
          onerror: (e: ErrorEvent) => handleError(e),
          onclose: () => cleanup(),
        },
        config: {
          inputAudioTranscription: {},
          // responseModalities is required by the API, even if we don't use the audio output
          responseModalities: [Modality.AUDIO], 
        },
      });

      sessionPromiseRef.current.catch(handleError);

    } catch (error) {
      handleError(error);
    }
  };
  
  const handleReset = () => {
    cleanup();
    setAppState('IDLE');
    setLiveTranscript('');
    setFinalTranscript('');
    setErrorMessage('');
    liveTranscriptAccumulatorRef.current = '';
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6">
      <main className="w-full max-w-2xl mx-auto flex flex-col items-center space-y-8">
        <header className="text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-white">AI Voice Memo</h1>
          <p className="text-lg text-gray-400 mt-2">Record, Transcribe, and Identify Speakers</p>
        </header>
        
        <StatusIndicator appState={appState} errorMessage={errorMessage} />
        
        <TranscriptDisplay liveTranscript={liveTranscript} finalTranscript={finalTranscript} appState={appState} />

        <footer className="fixed bottom-0 left-0 right-0 p-4 bg-gray-900/50 backdrop-blur-sm flex justify-center">
             <ControlButton
                appState={appState}
                onStart={handleStartRecording}
                onStop={handleStopRecording}
                onReset={handleReset}
             />
        </footer>
      </main>
    </div>
  );
}
