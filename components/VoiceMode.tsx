
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { Persona, Feedback, Scenario, Message } from '../types';
import { getApiKey } from '../services/api';
import { decode, decodeAudioData, createPcmBlob } from '../services/audioUtils';
import { generateTranscript, generateHtmlTranscript, generateStudyGuideHtml, generateSessionJson, downloadFile, shareToInstructor } from '../services/reportUtils';

interface VoiceModeProps {
  persona: Persona;
  scenario: Scenario;
  onExit: () => void;
  initialMessages?: Message[];
  requestFeedback: boolean;
}

export const VoiceMode: React.FC<VoiceModeProps> = ({ persona, scenario, onExit, initialMessages, requestFeedback }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [history, setHistory] = useState<Message[]>(initialMessages || []);
  const [currentInput, setCurrentInput] = useState("");
  const [currentOutput, setCurrentOutput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [isContextExpanded, setIsContextExpanded] = useState(true);
  const [showPostSessionFeedback, setShowPostSessionFeedback] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Recording Ref
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const cleanup = useCallback(() => {
    if (sessionRef.current) sessionRef.current.close();
    if (audioContextRef.current) audioContextRef.current.close();
    if (outputContextRef.current) outputContextRef.current.close();
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
    sourcesRef.current.forEach(s => s.stop());
    sourcesRef.current.clear();
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, currentOutput, currentInput]);

  const recordingDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const aiGainNodeRef = useRef<GainNode | null>(null);

  const [imgError, setImgError] = useState(false);
  const portraitSrc = `/portraits/${persona.id}.png`;

  useEffect(() => {
    setImgError(false);
  }, [persona]);

  const startSession = async () => {
    console.log("Starting voice session...");
    setIsConnecting(true);
    setError(null);
    try {
      const apiKey = getApiKey();
      if (!apiKey) {
        console.error("API Key missing");
        setError("Gemini API Key is missing. Please check your settings.");
        setIsConnecting(false);
        return;
      }
      const ai = new GoogleGenAI({ apiKey });
      
      // 1. Get Mic Audio
      console.log("Requesting microphone access...");
      let micStream: MediaStream;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        console.error("Mic access denied", err);
        setError("Microphone access is required for Voice Mode. Please check your browser permissions.");
        setIsConnecting(false);
        return;
      }

      // 2. Get Screen Video (Optional)
      console.log("Requesting optional screen share...");
      let screenStream: MediaStream | null = null;
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
          screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false 
          }).catch(e => {
            console.warn("getDisplayMedia rejected or cancelled:", e);
            return null;
          });
        }
      } catch (err) {
        console.warn("Screen recording cancelled or not supported", err);
      }

      console.log("Initializing audio contexts...");
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const ctx = outputContextRef.current;

      // Setup mixing for recording (Mic + AI)
      const recordingDest = ctx.createMediaStreamDestination();
      recordingDestRef.current = recordingDest;

      // Gain node for AI audio (goes to speakers AND recorder)
      const aiGainNode = ctx.createGain();
      aiGainNode.connect(ctx.destination); // To Speakers
      aiGainNode.connect(recordingDest);   // To Recorder
      aiGainNodeRef.current = aiGainNode;
      
      // Add Mic to Recorder (but NOT speakers to avoid feedback)
      const micSource = ctx.createMediaStreamSource(micStream);
      micSource.connect(recordingDest);

      // Combine Screen Video + Mixed Audio (or just Audio if no screen)
      const tracks = [...recordingDest.stream.getAudioTracks()];
      if (screenStream) {
        tracks.push(...screenStream.getVideoTracks());
      }
      
      const combinedStream = new MediaStream(tracks);

      // Setup MediaRecorder with the combined stream
      console.log("Setting up MediaRecorder...");
      const mimeType = screenStream ? 'video/webm; codecs=vp9' : 'audio/webm; codecs=opus';
      const mediaRecorder = new MediaRecorder(combinedStream, { mimeType });

      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };
      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      const source = audioContextRef.current.createMediaStreamSource(micStream);
      
      console.log("Connecting to Live API...");
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `${persona.systemInstruction} 
            ${persona.embeddedContext ? `Persona Context: ${persona.embeddedContext}` : ""}
            Current Situation: ${scenario.systemPrompt}. 
            ${scenario.embeddedContext ? `Scenario Context: ${scenario.embeddedContext}` : ""}
            Start by greeting the student in character.`,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: persona.voiceName } }
          },
          outputAudioTranscription: {},
          inputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            console.log("Live API connection opened");
            setIsConnected(true);
            setIsConnecting(false);
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const base64Pcm = createPcmBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: { data: base64Pcm, mimeType: 'audio/pcm;rate=16000' } });
              });
            };
            source.connect(scriptProcessor);
            // Connect to a silent gain node to keep it running without feedback
            const silentGain = audioContextRef.current!.createGain();
            silentGain.gain.value = 0;
            scriptProcessor.connect(silentGain);
            silentGain.connect(audioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              setCurrentInput(prev => prev + (message.serverContent?.inputTranscription?.text || ""));
            }
            if (message.serverContent?.outputTranscription) {
              setCurrentOutput(prev => prev + (message.serverContent?.outputTranscription?.text || ""));
            }
            if (message.serverContent?.turnComplete) {
              setHistory(prev => {
                const newHistory = [...prev];
                if (currentInput) newHistory.push({ role: 'user', text: currentInput });
                if (currentOutput) newHistory.push({ role: 'model', text: currentOutput });
                return newHistory;
              });
              setCurrentInput("");
              setCurrentOutput("");
            }
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && outputContextRef.current && aiGainNodeRef.current) {
              const ctx = outputContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const sourceNode = ctx.createBufferSource();
              sourceNode.buffer = buffer;
              sourceNode.connect(aiGainNodeRef.current);
              sourceNode.onended = () => sourcesRef.current.delete(sourceNode);
              sourceNode.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(sourceNode);
            }
          },
          onclose: () => {
            console.log("Live API connection closed");
            setIsConnected(false);
            setIsConnecting(false);
          },
          onerror: (e) => {
            console.error("Live API Error:", e);
            setError("Connection error. Please try again.");
            setIsConnecting(false);
          }
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Failed to start voice session:", err);
      setError("Failed to initialize session. Please check your microphone and internet connection.");
      setIsConnecting(false);
    }
  };

  const handleExitWithRecording = useCallback(() => {
    if (isRecording && mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = () => {
        if (audioChunksRef.current.length > 0) {
          const isVideo = mediaRecorderRef.current?.mimeType.includes('video');
          const blob = new Blob(audioChunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'video/webm' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const date = new Date().toISOString().split('T')[0];
          a.download = `${date}_Recording_${persona.name.replace(/\s/g, '_')}.${isVideo ? 'webm' : 'ogg'}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
        
        if (requestFeedback) {
          setShowPostSessionFeedback(true);
        } else {
          onExit();
        }
      };
      mediaRecorderRef.current.stop();
    } else {
      if (requestFeedback) {
        setShowPostSessionFeedback(true);
      } else {
        onExit();
      }
    }
  }, [isRecording, persona.name, requestFeedback, onExit]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Global shortcuts for VoiceMode
    if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!isConnected && !isConnecting) {
        startSession();
      } else if (isConnected) {
        handleExitWithRecording();
      }
    } else if (e.key.toLowerCase() === 't' && isConnected) {
      e.preventDefault();
      setShowTranscript(prev => !prev);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleExitWithRecording();
    }
  }, [isConnected, isConnecting, startSession, handleExitWithRecording]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleSaveProgress = () => {
    const json = generateSessionJson(persona, scenario, history, 'voice');
    const filename = `session_${persona.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.json`;
    downloadFile(json, filename, 'application/json');
  };

  const handleDownloadStudyGuide = async () => {
    const html = await generateStudyGuideHtml(persona, scenario, history);
    downloadFile(html, `StudyGuide_${persona.name.replace(/\s/g, '_')}_${scenario.title.replace(/\s/g, '_')}.html`, 'text/html');
  };

  const toggleFlag = (index: number) => {
    setHistory(prev => prev.map((m, i) => 
      i === index ? { ...m, isFlagged: !m.isFlagged } : m
    ));
  };

  const handleDownloadPortfolio = async () => {
    const isVideo = mediaRecorderRef.current?.mimeType.includes('video');
    const sessionBlob = new Blob(audioChunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'video/webm' });
    
    const html = await generateHtmlTranscript(persona, scenario, history, sessionBlob);
    downloadFile(html, `Portfolio_Voice_${persona.name.replace(/\s/g, '_')}.html`, 'text/html');

    if (audioChunksRef.current.length > 0) {
      const url = URL.createObjectURL(sessionBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Session_Recording_${persona.name.replace(/\s/g, '_')}.${isVideo ? 'webm' : 'ogg'}`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleShare = () => {
    shareToInstructor(persona, scenario);
  };

  return (
    <div 
      className="flex flex-col h-full bg-[#00274C] text-white rounded-none md:rounded-3xl overflow-hidden shadow-2xl border-0 md:border-4 border-[#FFCB05]/40 relative"
      role="region"
      aria-label={`Voice conversation with ${persona.name}`}
    >
      {/* Dynamic Header */}
      <div className="p-3 md:p-6 bg-[#001d3a] border-b border-[#FFCB05]/30 flex flex-row justify-between items-center gap-2 md:gap-4 shrink-0" role="banner">
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <div className="relative shrink-0">
            <div className="w-8 h-8 md:w-14 md:h-14 rounded-full border-2 border-[#FFCB05] shadow-lg bg-[#00274C] flex items-center justify-center text-lg md:text-2xl overflow-hidden">
              {!imgError ? (
                <img 
                  src={portraitSrc} 
                  alt={persona.name} 
                  className="w-full h-full object-cover" 
                  onError={() => setImgError(true)}
                />
              ) : (
                persona.avatar
              )}
            </div>
            {isConnected && <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 md:w-4 md:h-4 bg-green-500 border-2 border-[#001d3a] rounded-full animate-pulse" aria-label="Connected"></div>}
          </div>
          <div className="min-w-0">
            <h2 className="text-xs md:text-xl font-black text-white tracking-tight truncate">{persona.name}</h2>
            <p className="text-[6px] md:text-[10px] text-[#FFCB05] font-black uppercase tracking-widest truncate">{scenario.title}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
          {isConnected && (
            <>
              <button 
                onClick={() => setShowTranscript(!showTranscript)}
                className={`lg:hidden flex items-center gap-1 text-[7px] font-black uppercase tracking-widest transition-all px-2 py-1 rounded-lg border ${showTranscript ? 'bg-[#FFCB05] text-[#00274C] border-[#FFCB05]' : 'text-[#FFCB05] border-[#FFCB05]/30'}`}
                aria-label="Toggle Transcript (T)"
                aria-pressed={showTranscript}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                Transcript
              </button>
              <button 
                onClick={handleSaveProgress}
                className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-[#FFCB05] text-[#00274C] rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#FFCB05] transition-all shadow-sm active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#FFCB05]"
                title="Save session to resume later"
                aria-label="Save Progress"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
                <span className="hidden sm:inline">Save Progress</span>
                <span className="sm:hidden">Save</span>
              </button>
              <button 
                onClick={handleDownloadPortfolio}
                className="flex items-center gap-1 md:gap-2 text-[#00274C] bg-[#FFCB05] hover:bg-white font-black text-[7px] md:text-[10px] uppercase tracking-widest transition-all px-2 md:px-4 py-1 md:py-2 rounded-lg md:rounded-xl shadow-md focus:outline-none focus:ring-2 focus:ring-white"
                aria-label="Download Portfolio"
              >
                <svg className="w-3 h-3 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                <span className="hidden xs:inline">Portfolio</span>
              </button>
              <button 
                onClick={handleShare}
                className="hidden sm:flex items-center gap-2 text-[#FFCB05] hover:text-white font-black text-[10px] uppercase tracking-widest transition-colors border-2 border-[#FFCB05]/30 px-4 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FFCB05]"
                aria-label="Share with Instructor"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                Share
              </button>
            </>
          )}
          <button 
            onClick={handleExitWithRecording} 
            className="bg-red-600/20 hover:bg-red-600/50 text-white px-2 md:px-5 py-1 md:py-2 rounded-lg md:rounded-xl text-[7px] md:text-[10px] font-black uppercase tracking-widest transition-all border border-red-600/30 focus:outline-none focus:ring-2 focus:ring-red-500"
            aria-label="Exit Session (Esc)"
          >
            Exit
          </button>
        </div>
      </div>

      {/* Main Area */}
      <div 
        className={`flex-grow flex flex-col items-center p-4 md:p-8 space-y-4 md:space-y-6 relative w-full ${!isConnected ? 'overflow-y-auto' : 'overflow-hidden'}`}
        role="main"
      >
        {/* Collapsible Context Reminder (Always visible if connected) */}
        {isConnected && (
          <div className="w-full max-w-3xl shrink-0 animate-in slide-in-from-top duration-500 z-20">
            <div className="bg-[#FFCB05]/10 border border-[#FFCB05]/20 rounded-xl md:rounded-2xl overflow-hidden backdrop-blur-sm transition-all duration-300">
              <button 
                onClick={() => setIsContextExpanded(!isContextExpanded)}
                className="w-full p-3 md:p-4 flex items-center justify-between text-[#FFCB05] hover:bg-[#FFCB05]/5 transition-colors"
              >
                <div className="flex items-center gap-2 md:gap-3">
                  <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  <span className="text-[9px] md:text-[10px] font-black uppercase tracking-widest">Scenario Objective</span>
                </div>
                <svg 
                  className={`w-3.5 h-3.5 md:w-4 md:h-4 transition-transform duration-300 ${isContextExpanded ? 'rotate-180' : ''}`} 
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/>
                </svg>
              </button>
              
              <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isContextExpanded ? 'max-h-40 p-3 md:p-4 border-t border-[#FFCB05]/10' : 'max-h-0'}`}>
                <p className="text-[#FFCB05]/90 text-xs md:text-sm font-medium leading-relaxed italic">
                  "{scenario.context}"
                </p>
              </div>
            </div>
          </div>
        )}

        {!isConnected ? (
          <>
            <div className="flex-grow shrink-0 min-h-[10px] md:min-h-[20px]"></div>
            <div className="text-center space-y-4 md:space-y-10 py-4 md:py-8 animate-in fade-in zoom-in duration-700 w-full max-w-2xl mx-auto flex flex-col shrink-0">
              <div className="relative">
                <div className="w-32 h-32 md:w-64 md:h-64 bg-[#FFCB05] rounded-full flex items-center justify-center mx-auto shadow-2xl relative z-10 border-4 md:border-8 border-[#00274C] overflow-hidden group">
               {!imgError ? (
                 <>
                   <img 
                     src={portraitSrc} 
                     alt={persona.name} 
                     className="w-full h-full object-cover" 
                     onError={() => setImgError(true)}
                   />
                   <div className="absolute bottom-2 right-2 md:bottom-4 md:right-4 flex gap-1 md:gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                     <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          const link = document.createElement('a');
                          link.href = portraitSrc;
                          link.download = `${persona.id}.png`;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }}
                        className="bg-[#00274C]/80 hover:bg-[#00274C] text-[#FFCB05] p-1.5 md:p-2 rounded-full transition-all shadow-lg transform hover:scale-110"
                        title="Download Portrait"
                      >
                        <svg className="w-3 h-3 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                      </button>
                   </div>
                 </>
               ) : (
                 <div className="text-4xl md:text-8xl">{persona.avatar}</div>
               )}
            </div>
              </div>
              
              <div className="space-y-2 md:space-y-4">
                <h2 className="text-xl md:text-4xl font-black text-white uppercase tracking-tight">Real-Time Voice Bridge</h2>
                <div className="bg-[#FFCB05]/10 border border-[#FFCB05]/20 p-3 md:p-6 rounded-xl md:rounded-2xl max-w-lg mx-auto backdrop-blur-sm">
                  <p className="text-[#FFCB05] text-[10px] md:text-sm font-bold leading-relaxed italic">" {scenario.context} "</p>
                </div>
                
                {scenario.hints && scenario.hints.length > 0 && (
                  <div className="max-w-md mx-auto mt-2 md:mt-6 text-left">
                    <p className="text-[#FFCB05]/60 text-[7px] md:text-[10px] font-black uppercase tracking-widest mb-1.5 text-center">Conversation Hints</p>
                    <ul className="space-y-1 md:space-y-2">
                      {scenario.hints.map((hint, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-[9px] md:text-xs text-white/80 bg-white/5 p-1 md:p-2 rounded-lg border border-white/5">
                          <span className="text-[#FFCB05] mt-0.5">•</span>
                          <span>{hint}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {error && (
                  <div className="max-w-md mx-auto mt-4 p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-xs font-bold animate-in fade-in slide-in-from-top-2">
                    {error}
                  </div>
                )}
              </div>
 
              <button 
                onClick={startSession} 
                disabled={isConnecting}
                className={`maize-pulse-btn bg-[#FFCB05] hover:bg-white text-[#00274C] px-6 md:px-14 py-3 md:py-6 rounded-xl md:rounded-2xl font-black text-sm md:text-xl shadow-2xl transition-all transform hover:scale-105 active:scale-95 uppercase tracking-widest flex items-center gap-2 md:gap-4 mx-auto focus:outline-none focus:ring-4 focus:ring-[#FFCB05]/50 ${isConnecting ? 'opacity-70 cursor-not-allowed' : ''}`}
                aria-label={isConnecting ? "Connecting to session" : "Start Conversation (S)"}
              >
                {isConnecting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-[#00274C] border-t-transparent rounded-full animate-spin"></div>
                    <span>Connecting...</span>
                  </>
                ) : (
                  <>
                    <span>Start Conversation</span>
                    <svg className="w-4 h-4 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 5l7 7-7 7M5 5l7 7-7 7"/></svg>
                  </>
                )}
              </button>
            </div>
            <div className="flex-grow shrink-0 min-h-[10px] md:min-h-[20px]"></div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col lg:flex-row overflow-hidden relative">
            {/* Left Side: Avatar & Visuals */}
            <div className="flex-1 flex flex-col items-center justify-center relative p-4 md:p-6 overflow-y-auto lg:overflow-hidden">
              {/* Active Session View */}
              <div className="relative mb-4 md:mb-8">
                <div className="w-32 h-32 md:w-64 md:h-64 bg-[#FFCB05] rounded-full flex items-center justify-center mx-auto shadow-2xl relative z-10 border-4 md:border-8 border-[#00274C] overflow-hidden group">
                   {!imgError ? (
                     <>
                       <img 
                         src={portraitSrc} 
                         alt={persona.name} 
                         className="w-full h-full object-cover" 
                         onError={() => setImgError(true)}
                       />
                       <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            const link = document.createElement('a');
                            link.href = portraitSrc;
                            link.download = `${persona.id}.png`;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          }}
                          className="absolute bottom-2 right-2 md:bottom-4 md:right-4 bg-[#00274C]/80 hover:bg-[#00274C] text-[#FFCB05] p-1.5 md:p-2 rounded-full transition-all opacity-0 group-hover:opacity-100 shadow-lg transform hover:scale-110 z-30"
                          title="Download Portrait"
                        >
                          <svg className="w-3 h-3 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                        </button>
                     </>
                   ) : (
                     <div className="text-5xl md:text-9xl">{persona.avatar}</div>
                   )}
                </div>
                {/* Subtle speaking indicator */}
                <div className="absolute -bottom-2 md:-bottom-4 left-1/2 transform -translate-x-1/2 bg-[#00274C] px-2.5 md:px-4 py-0.5 md:py-1 rounded-full border border-[#FFCB05]/30 shadow-lg z-20">
                  <div className="flex gap-0.5 md:gap-1 h-2.5 md:h-4 items-end">
                    <div className="w-0.5 md:w-1 bg-[#FFCB05] animate-pulse h-1 md:h-2"></div>
                    <div className="w-0.5 md:w-1 bg-[#FFCB05] animate-pulse h-2 md:h-4 delay-75"></div>
                    <div className="w-0.5 md:w-1 bg-[#FFCB05] animate-pulse h-1.5 md:h-3 delay-150"></div>
                  </div>
                </div>
              </div>

              {/* Hints */}
              {scenario.hints && scenario.hints.length > 0 && (
                  <div className="max-w-md w-full bg-[#001d3a]/80 backdrop-blur-md border border-[#FFCB05]/10 p-2.5 md:p-4 rounded-xl mt-1 md:mt-4">
                    <p className="text-[#FFCB05]/60 text-[7px] md:text-[10px] font-black uppercase tracking-widest mb-1.5 md:mb-3 text-center">Talking Points</p>
                    <ul className="space-y-1 md:space-y-2">
                      {scenario.hints.map((hint, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-[9px] md:text-xs text-white/90">
                          <span className="text-[#FFCB05] mt-0.5">→</span>
                          <span>{hint}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
              )}
            </div>

            {/* Right Side: Transcript Panel */}
            <div className={`absolute inset-0 lg:relative lg:inset-auto lg:w-96 bg-[#001d3a]/95 border-l border-[#FFCB05]/10 flex flex-col shrink-0 transition-all duration-300 z-30 ${showTranscript ? 'flex' : 'hidden lg:flex'}`}>
              <div className="p-3 md:p-4 border-b border-[#FFCB05]/10 bg-[#00274C]/50 backdrop-blur-sm flex justify-between items-center">
                <h3 className="text-[#FFCB05] text-[10px] md:text-xs font-black uppercase tracking-widest flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                  Live Transcript
                </h3>
                <div className="flex items-center gap-3">
                  {history.some(m => m.isFlagged) && (
                    <button 
                      onClick={handleDownloadStudyGuide}
                      className="p-1.5 bg-[#FFCB05] text-[#00274C] rounded-lg hover:bg-white hover:text-[#00274C] transition-all shadow-sm active:scale-95"
                      title="Download Study Guide as HTML"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                    </button>
                  )}
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></div>
                    <span className="text-[8px] md:text-[9px] font-bold text-white/40 uppercase">Rec</span>
                  </div>
                  <button onClick={() => setShowTranscript(false)} className="lg:hidden text-white/30 hover:text-white p-1">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
              
              <div ref={scrollRef} className="flex-grow overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/20">
                {history.map((turn, i) => (
                  <div key={i} className={`flex flex-col ${turn.role === 'user' ? 'items-end' : 'items-start'} animate-in slide-in-from-bottom-2 duration-300 group`}>
                    <div className={`p-3 rounded-2xl max-w-[90%] text-xs font-medium leading-relaxed shadow-sm relative ${turn.role === 'user' ? 'bg-[#FFCB05] text-[#00274C] rounded-tr-none' : 'bg-[#003d77] text-white rounded-tl-none border border-white/10'}`}>
                      <div className="flex justify-between items-start gap-2 mb-1">
                        <span className={`text-[8px] font-black uppercase tracking-widest opacity-50 ${turn.role === 'user' ? 'text-[#00274C]' : 'text-[#FFCB05]'}`}>
                          {turn.role === 'user' ? 'You' : persona.name}
                        </span>
                        {turn.role === 'model' && (
                          <button 
                            onClick={() => toggleFlag(i)}
                            className={`p-1 rounded-lg transition-colors opacity-0 group-hover:opacity-100 ${turn.isFlagged ? 'text-[#FFCB05] bg-[#00274C] opacity-100' : 'text-white/30 hover:text-white hover:bg-white/10'}`}
                            title="Flag as Important"
                          >
                            <svg className={`w-3 h-3 ${turn.isFlagged ? 'fill-current' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
                          </button>
                        )}
                      </div>
                      {turn.text}
                      {turn.isFlagged && (
                        <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 bg-[#FFCB05] text-[#00274C] rounded-full p-1 shadow-md border-2 border-[#00274C]">
                          <svg className="w-2 h-2 fill-current" viewBox="0 0 24 24"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                
                {(currentInput || currentOutput) && (
                  <div className="space-y-4">
                    {currentInput && (
                      <div className="flex flex-col items-end">
                        <div className="bg-[#FFCB05]/20 border border-[#FFCB05]/30 text-white p-3 rounded-2xl rounded-tr-none text-xs max-w-[90%] animate-pulse">
                           <span className="text-[8px] font-black uppercase tracking-widest opacity-50 mb-1 block text-[#FFCB05]">Listening...</span>
                           {currentInput}
                        </div>
                      </div>
                    )}
                    {currentOutput && (
                      <div className="flex flex-col items-start">
                        <div className="bg-white/5 border border-white/10 text-white p-3 rounded-2xl rounded-tl-none text-xs max-w-[90%] animate-pulse">
                           <span className="text-[8px] font-black uppercase tracking-widest opacity-50 mb-1 block text-white">Thinking...</span>
                           {currentOutput}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0, 39, 76, 0.1); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #FFCB05; border-radius: 10px; }
        
        @keyframes maize-btn-pulse {
          0% { box-shadow: 0 0 0 0 rgba(255, 203, 5, 0.6); }
          70% { box-shadow: 0 0 0 20px rgba(255, 203, 5, 0); }
          100% { box-shadow: 0 0 0 0 rgba(255, 203, 5, 0); }
        }

        .maize-pulse-btn {
          animation: maize-btn-pulse 2s infinite;
        }
      `}</style>
      {showPostSessionFeedback && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-xl w-full text-center space-y-6">
            <h2 className="text-2xl font-black text-[#00274C] uppercase tracking-widest">Session Complete</h2>
            <p className="text-slate-600">Your conversation has been recorded and exported. Please provide some brief feedback for your English simulation portfolio.</p>
            <div className="p-6 bg-[#F8F9FA] rounded-2xl border-2 border-[#00274C]/10 text-left">
              <label className="block text-[10px] font-black text-[#00274C] uppercase tracking-widest mb-2">Confidence Level</label>
              <div className="flex gap-2 mb-4">
                {[1,2,3,4,5].map(v => (
                  <button key={v} className="w-10 h-10 rounded-lg border-2 border-[#00274C]/20 hover:border-[#FFCB05] hover:bg-[#FFCB05]/10 flex items-center justify-center font-bold text-[#00274C]">{v}</button>
                ))}
              </div>
              <label className="block text-[10px] font-black text-[#00274C] uppercase tracking-widest mb-2">Self-Reflection</label>
              <textarea className="w-full p-4 rounded-xl border-2 border-[#00274C]/10 outline-none focus:border-[#00274C] text-[#00274C]" rows={4} placeholder="How did you feel during this interaction?"></textarea>
            </div>
            <button 
              onClick={onExit}
              className="w-full bg-[#00274C] text-[#FFCB05] py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-[#003d77] transition-all"
            >
              Finish & Return to Main Menu
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
