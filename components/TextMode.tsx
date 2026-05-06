
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { Persona, Message, Feedback, Scenario } from '../types';
import { decode, decodeAudioData, createWavBlob } from '../services/audioUtils';
import { getApiKey } from '../services/api';
import { FeedbackForm } from './FeedbackForm';
import { generateTranscript, generateHtmlTranscript, generateStudyGuideHtml, generateSessionJson, downloadFile, shareToInstructor } from '../services/reportUtils';
import { useScreenRecorder } from '../hooks/useScreenRecorder';

interface TextModeProps {
  persona: Persona;
  scenario: Scenario;
  onExit: () => void;
  portraits: Record<string, string>;
  setPortraits: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  initialMessages?: Message[];
  requestFeedback: boolean;
}

interface Alternative {
  text: string;
  label: string;
}

export const TextMode: React.FC<TextModeProps> = ({ persona, scenario, onExit, initialMessages, requestFeedback }) => {
  const [messages, setMessages] = useState<Message[]>(initialMessages || []);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState<number | string | null>(null);
  const [isDownloading, setIsDownloading] = useState<number | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [feedbackPanelIndex, setFeedbackPanelIndex] = useState<number | null>(null);
  const [showStudyGuide, setShowStudyGuide] = useState(false);
  const [showBriefing, setShowBriefing] = useState(true);
  const [speechRate, setSpeechRate] = useState(1.0);
  const [pendingAlternatives, setPendingAlternatives] = useState<Alternative[] | null>(null);
  const [lastAlternatives, setLastAlternatives] = useState<Alternative[] | null>(null);
  const [selectedAltIndex, setSelectedAltIndex] = useState<number | null>(null);
  const [showHints, setShowHints] = useState(false);
  const [userVoiceName, setUserVoiceName] = useState<'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr'>('Zephyr');
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [showPostSessionFeedback, setShowPostSessionFeedback] = useState(false);
  const portraitSrc = `./portraits/${persona.id}.png`;

  const { isRecording: isVideoRecording, startRecording: startVideoRecording, stopRecording: stopVideoRecording } = useScreenRecorder(persona.name);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<any>(null);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const getAIResponse = async (history: Message[]) => {
    setIsTyping(true);
    setPendingAlternatives(null);
    setLastAlternatives(null);
    setSelectedAltIndex(null);
    try {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      
      const historyContents = history.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      const contents = historyContents.length > 0 
        ? historyContents 
        : [{ role: 'user', parts: [{ text: 'Please start the conversation based on the context.' }] }];

      const systemInstruction = `You are ${persona.name}, ${persona.title}. ${persona.systemInstruction} 
      ${persona.embeddedContext ? `Persona Context: ${persona.embeddedContext}` : ""}
      Current Situation: ${scenario.systemPrompt} 
      ${scenario.embeddedContext ? `Scenario Context: ${scenario.embeddedContext}` : ""}
      Task: Provide 3 alternative ways you would respond to the student right now. 
      Vary the tone slightly for each (e.g., one more direct, one more supportive, one more formal) while staying in character. 
      Keep each response between 1-3 sentences.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              options: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING, description: "The response text." },
                    label: { type: Type.STRING, description: "A short tone label (e.g., 'Direct', 'Formal', 'Supportive')." }
                  },
                  required: ["text", "label"]
                },
                minItems: 3,
                maxItems: 3
              }
            },
            required: ["options"]
          }
        }
      });

      const jsonStr = response.text.trim();
      const data = JSON.parse(jsonStr);
      setPendingAlternatives(data.options);
    } catch (err) {
      console.error("AI Error:", err);
    } finally {
      setIsTyping(false);
    }
  };

  useEffect(() => {
    getAIResponse([]);

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false; 
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';
      recognitionRef.current.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0])
          .map((result: any) => result.transcript)
          .join('');
        setInputValue(transcript);
      };
      recognitionRef.current.onstart = () => setIsListening(true);
      recognitionRef.current.onend = () => setIsListening(false);
    }

    return () => {
      if (audioContextRef.current) audioContextRef.current.close();
      if (recognitionRef.current) recognitionRef.current.stop();
      if (currentAudioSourceRef.current) currentAudioSourceRef.current.stop();
    };
  }, [persona, scenario]);

  const playTTS = async (text: string, index: number | string, isUser: boolean = false) => {
    if (currentAudioSourceRef.current) {
      try { currentAudioSourceRef.current.stop(); } catch (e) {}
      currentAudioSourceRef.current = null;
    }

    // Stop browser TTS if running
    window.speechSynthesis.cancel();

    const voiceName = isUser ? userVoiceName : persona.voiceName;
    const playIndex = index;
    setIsSpeaking(playIndex);

    // Check if offline or if we should use browser TTS
    if (!navigator.onLine) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = speechRate;
      utterance.onend = () => setIsSpeaking(null);
      window.speechSynthesis.speak(utterance);
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
        },
      });

      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (audioData) {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const buffer = await decodeAudioData(decode(audioData), audioContextRef.current, 24000, 1);
        const source = audioContextRef.current.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = speechRate;
        source.connect(audioContextRef.current.destination);
        source.onended = () => {
          if (currentAudioSourceRef.current === source) {
            setIsSpeaking(null);
            currentAudioSourceRef.current = null;
          }
        };
        currentAudioSourceRef.current = source;
        source.start();
      } else {
        throw new Error("No audio data");
      }
    } catch (err) {
      console.error("TTS Error, falling back to browser:", err);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = speechRate;
      utterance.onend = () => setIsSpeaking(null);
      window.speechSynthesis.speak(utterance);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        setRecordedAudioUrl(audioUrl);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Recording Error:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleSendWithAudio = async (text: string, audioUrl?: string) => {
    if (!text.trim() || isTyping || pendingAlternatives) return;

    const userMsg: Message = { 
      role: 'user', 
      text, 
      timestamp: Date.now(),
      audioUrl 
    };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInputValue("");
    getAIResponse(newHistory);
  };

  const handleDownloadAudio = async (text: string, index: number) => {
    setIsDownloading(index);
    try {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: persona.voiceName } },
          },
        },
      });

      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (audioData) {
        const pcmBytes = decode(audioData);
        const wavBlob = createWavBlob(pcmBytes, 24000);
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Audio_${persona.name.replace(/\s/g, '_')}_Turn${index + 1}.wav`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Download Error:", err);
    } finally {
      setIsDownloading(null);
    }
  };

  const handleSelectAlternative = (alt: Alternative, index: number) => {
    if (selectedAltIndex !== null) return;
    
    setSelectedAltIndex(index);
    setLastAlternatives(pendingAlternatives);
    
    setTimeout(() => {
      const newMessage: Message = { role: 'model', text: alt.text, timestamp: Date.now() };
      const updatedMessages = [...messages, newMessage];
      setMessages(updatedMessages);
      setPendingAlternatives(null);
      setSelectedAltIndex(null);
      playTTS(alt.text, updatedMessages.length - 1);
    }, 600);
  };

  const handleRevertTurn = () => {
    if (!lastAlternatives) return;
    const updated = [...messages];
    if (updated.length > 0 && updated[updated.length - 1].role === 'model') {
      updated.pop();
      setMessages(updated);
      setPendingAlternatives(lastAlternatives);
      setLastAlternatives(null);
      if (currentAudioSourceRef.current) {
        try { currentAudioSourceRef.current.stop(); } catch (e) {}
      }
      setIsSpeaking(null);
    }
  };

  const toggleFlag = (index: number) => {
    const updated = [...messages];
    updated[index] = { ...updated[index], isFlagged: !updated[index].isFlagged };
    setMessages(updated);
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim() || isTyping || pendingAlternatives) return;

    const userMsg: Message = { 
      role: 'user', 
      text: inputValue, 
      timestamp: Date.now(),
      audioUrl: recordedAudioUrl || undefined
    };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInputValue("");
    setRecordedAudioUrl(null);
    getAIResponse(newHistory);
  };

  const saveFeedback = (index: number, feedback: Feedback) => {
    const updatedMessages = [...messages];
    updatedMessages[index].feedback = feedback;
    setMessages(updatedMessages);
    setFeedbackPanelIndex(null);
  };

  const handleSaveProgress = () => {
    const json = generateSessionJson(persona, scenario, messages, 'text');
    const filename = `session_${persona.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.json`;
    downloadFile(json, filename, 'application/json');
  };

  const handleDownloadStudyGuide = async () => {
    const html = await generateStudyGuideHtml(persona, scenario, messages);
    downloadFile(html, `StudyGuide_${persona.name.replace(/\s/g, '_')}_${scenario.title.replace(/\s/g, '_')}.html`, 'text/html');
  };

  const handleDownload = async () => {
    const html = await generateHtmlTranscript(persona, scenario, messages);
    downloadFile(html, `Portfolio_${persona.name.replace(/\s/g, '_')}_${scenario.title.replace(/\s/g, '_')}.html`, 'text/html');
  };

  const handleShare = () => {
    shareToInstructor(persona, scenario);
  };

  const handleExitWithRecording = () => {
    stopVideoRecording();
    if (requestFeedback) {
      setShowPostSessionFeedback(true);
    } else {
      onExit();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Global shortcuts for TextMode
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (isSpeaking !== null) {
          // If something is speaking, stop it
          if (currentAudioSourceRef.current) {
            try { currentAudioSourceRef.current.stop(); } catch (e) {}
            currentAudioSourceRef.current = null;
          }
          window.speechSynthesis.cancel();
          setIsSpeaking(null);
        } else if (messages.length > 0) {
          // If nothing is speaking, find the most recent model message to speak
          const lastModelIdx = [...messages].map((m, i) => ({m, i})).reverse().find(x => x.m.role === 'model')?.i;
          if (lastModelIdx !== undefined) {
            playTTS(messages[lastModelIdx].text, lastModelIdx);
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleExitWithRecording();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [messages, onExit, isSpeaking, requestFeedback]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, pendingAlternatives]);

  const flaggedMessages = messages.filter(m => m.isFlagged);
  const isLastMsgModel = messages.length > 0 && messages[messages.length - 1].role === 'model';

  return (
    <div 
      className="flex flex-col h-full bg-white rounded-none md:rounded-3xl overflow-hidden shadow-2xl border-0 md:border-2 border-[#00274C] relative"
      role="region"
      aria-label={`Text conversation with ${persona.name}`}
    >
      <div className="flex h-full relative">
        {/* Main Conversation Column */}
        <div 
          className={`flex flex-col transition-all duration-300 w-full ${feedbackPanelIndex !== null || showStudyGuide ? 'hidden lg:flex lg:w-[65%]' : 'flex w-full'}`}
          role="main"
        >
          {/* Header */}
          <div className="p-3 md:p-6 bg-[#00274C] flex flex-row justify-between items-center gap-2 md:gap-4 shrink-0" role="banner">
            <div className="flex items-center gap-2 md:gap-4 text-white min-w-0">
              <div className="w-8 h-8 md:w-12 md:h-12 rounded-full border-2 border-[#FFCB05] bg-[#00274C] flex items-center justify-center text-lg md:text-2xl overflow-hidden shrink-0 relative group">
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
                      className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Download Portrait"
                    >
                      <svg className="w-4 h-4 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                    </button>
                  </>
                ) : (
                  <div className="relative group w-full h-full flex items-center justify-center">
                    {persona.avatar}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <h2 className="text-xs md:text-lg font-black truncate">{persona.name}</h2>
                <p className="text-[6px] md:text-[10px] font-bold text-[#FFCB05] uppercase tracking-widest truncate">{scenario.title}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
              <div className="hidden sm:flex items-center gap-2 bg-white/10 px-2 py-1 rounded-lg border border-white/20">
                <span className="text-[8px] font-black uppercase tracking-widest text-[#FFCB05]">Your Voice:</span>
                <select 
                  value={userVoiceName} 
                  onChange={(e) => setUserVoiceName(e.target.value as any)}
                  className="bg-transparent text-white text-[9px] font-bold outline-none cursor-pointer"
                  aria-label="Select your voice"
                >
                  <option value="Kore" className="bg-[#00274C]">Kore</option>
                  <option value="Puck" className="bg-[#00274C]">Puck</option>
                  <option value="Charon" className="bg-[#00274C]">Charon</option>
                  <option value="Fenrir" className="bg-[#00274C]">Fenrir</option>
                  <option value="Zephyr" className="bg-[#00274C]">Zephyr</option>
                </select>
              </div>
              <button 
                onClick={() => { setShowStudyGuide(!showStudyGuide); setFeedbackPanelIndex(null); }}
                className={`flex items-center gap-1 md:gap-2 font-black text-[7px] md:text-[10px] uppercase tracking-widest transition-colors border px-2 md:px-3 py-1 md:py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFCB05] ${showStudyGuide ? 'bg-[#FFCB05] text-[#00274C] border-[#FFCB05]' : 'text-[#FFCB05] border-[#FFCB05]/30 hover:text-white'}`}
                aria-label="Toggle Study Guide"
                aria-pressed={showStudyGuide}
              >
                <svg className="w-3 h-3 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
                <span className="hidden xs:inline">Study Guide</span> ({flaggedMessages.length})
              </button>
              <button 
                onClick={handleSaveProgress}
                className="flex items-center gap-1.5 md:gap-2 px-2 md:px-4 py-1.5 md:py-2.5 bg-white border-2 border-[#00274C] text-[#00274C] rounded-lg md:rounded-xl text-[8px] md:text-[10px] font-black uppercase tracking-widest hover:bg-[#00274C] hover:text-[#FFCB05] transition-all shadow-sm active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#FFCB05]"
                title="Save session to resume later"
                aria-label="Save Progress"
              >
                <svg className="w-3 h-3 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
                <span className="hidden sm:inline">Save Progress</span>
                <span className="sm:hidden">Save</span>
              </button>
              <button 
                onClick={handleDownload}
                disabled={messages.length === 0}
                className="flex items-center gap-1 md:gap-2 text-[#FFCB05] hover:text-white font-black text-[7px] md:text-[10px] uppercase tracking-widest transition-colors border border-[#FFCB05]/30 px-2 md:px-3 py-1 md:py-2 rounded-lg disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-[#FFCB05]"
                aria-label="Download Portfolio"
              >
                <svg className="w-3 h-3 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                <span className="hidden xs:inline">Portfolio</span>
              </button>
              <button 
                onClick={handleExitWithRecording} 
                className="text-white bg-red-600/20 hover:bg-red-600/40 font-black text-[7px] md:text-[10px] uppercase tracking-widest transition-colors border border-red-600/30 px-2 md:px-4 py-1 md:py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                aria-label="Exit Session (Esc)"
              >
                Exit
              </button>
            </div>
          </div>

          {/* Message History */}
          <div 
            ref={scrollRef} 
            className="flex-grow p-4 md:p-6 overflow-y-auto space-y-4 md:space-y-6 bg-[#F8F9FA] custom-scrollbar"
            role="log"
            aria-label="Chat history"
            aria-live="polite"
          >
            {showBriefing && (
              <div className="mb-6 md:mb-8 p-4 md:p-6 bg-[#00274C]/5 border-l-4 border-[#00274C] rounded-r-2xl relative group">
                <div className="absolute top-3 md:top-4 right-3 md:right-4 flex gap-2">
                  <button 
                    onClick={() => playTTS(scenario.context, 'briefing')} 
                    className={`p-1 rounded-lg transition-colors ${isSpeaking === 'briefing' ? 'bg-[#FFCB05] text-[#00274C]' : 'text-[#00274C]/30 hover:text-[#00274C] hover:bg-[#00274C]/5'}`}
                    title="Hear briefing"
                  >
                    <svg className={`w-4 h-4 ${isSpeaking === 'briefing' ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
                  </button>
                </div>
                <div className="flex items-center gap-2 mb-1 md:mb-2 text-[#00274C]">
                  <span className="text-[9px] md:text-[10px] font-black uppercase tracking-widest">Scenario Briefing</span>
                </div>
                <p className="text-slate-700 text-xs md:text-sm leading-relaxed italic pr-6 md:pr-8 font-medium">"{scenario.context}"</p>
                
                <div className="mt-4 flex justify-end">
                  <button 
                    onClick={() => {
                      setShowBriefing(false);
                      startVideoRecording();
                    }}
                    className="bg-[#00274C] text-[#FFCB05] px-4 py-2 rounded-lg font-black uppercase tracking-widest text-[10px] hover:bg-[#003d77] transition-all"
                  >
                    Start Session & Record
                  </button>
                </div>
              </div>
            )}

            {/* Conversation Hints */}
            {scenario.hints && scenario.hints.length > 0 && (
              <div className="mb-8">
                <button 
                  onClick={() => setShowHints(!showHints)}
                  className="w-full flex items-center justify-between p-4 bg-white border border-[#00274C]/10 rounded-xl shadow-sm hover:bg-[#F8F9FA] transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg transition-colors ${showHints ? 'bg-[#FFCB05] text-[#00274C]' : 'bg-[#00274C]/5 text-[#00274C]/40 group-hover:text-[#00274C]'}`}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    </div>
                    <span className="text-xs font-black text-[#00274C] uppercase tracking-widest">Conversation Hints & Talking Points</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-[#00274C]/30 uppercase tracking-widest group-hover:text-[#00274C]/60 transition-colors">
                      {showHints ? 'Hide' : 'Show'}
                    </span>
                    <svg 
                      className={`w-4 h-4 text-[#00274C]/40 transition-transform duration-300 ${showHints ? 'rotate-180' : ''}`} 
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/>
                    </svg>
                  </div>
                </button>
                
                <div className={`transition-all duration-500 ease-in-out overflow-hidden ${showHints ? 'max-h-96 opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
                  <div className="bg-white border border-[#00274C]/10 rounded-xl p-5 shadow-sm">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#00274C]/40 mb-3">Consider discussing the following:</p>
                    <ul className="space-y-3">
                      {scenario.hints.map((hint, idx) => (
                        <li key={idx} className="flex items-start gap-3 text-sm text-slate-600">
                          <span className="text-[#FFCB05] mt-1.5 font-bold text-[10px]">●</span>
                          <span className="leading-relaxed font-medium">{hint}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex items-start gap-2 md:gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`max-w-[90%] md:max-w-[80%] space-y-1 ${m.role === 'user' ? 'text-right' : ''}`}>
                  <div className={`p-3 md:p-4 rounded-2xl shadow-sm text-xs md:text-sm font-medium relative group transition-all ${
                    m.role === 'user' ? 'bg-[#00274C] text-white rounded-tr-none' : `bg-white text-[#00274C] rounded-tl-none border ${m.isFlagged ? 'border-[#FFCB05] ring-2 ring-[#FFCB05]/20' : 'border-[#00274C]/10'}`
                  }`}>
                    <div className="flex justify-between items-start gap-4 mb-1">
                      <span className={`text-[9px] md:text-[10px] uppercase font-black tracking-widest ${m.role === 'user' ? 'text-[#FFCB05]' : 'text-[#00274C]/40'}`}>
                        {m.role === 'user' ? 'You' : persona.name}
                      </span>
                      <div className="flex gap-1 md:gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {m.role === 'user' && m.audioUrl && (
                          <button 
                            onClick={() => {
                              const audio = new Audio(m.audioUrl);
                              audio.play();
                            }}
                            className="p-1 rounded-lg text-[#FFCB05]/50 hover:text-[#FFCB05] hover:bg-white/10 transition-colors"
                            title="Play recording"
                          >
                            <svg className="w-3 h-3 md:w-3.5 md:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                          </button>
                        )}
                        <button 
                          onClick={() => playTTS(m.text, i, m.role === 'user')} 
                          className={`p-1 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#FFCB05] ${isSpeaking === i ? (m.role === 'user' ? 'bg-[#FFCB05] text-[#00274C]' : 'bg-[#FFCB05] text-[#00274C]') : (m.role === 'user' ? 'text-[#FFCB05]/30 hover:text-[#FFCB05] hover:bg-white/10' : 'text-[#00274C]/30 hover:text-[#00274C] hover:bg-[#00274C]/5')}`}
                          title={m.role === 'user' ? "Hear your message" : "Hear response (S)"}
                          aria-label={m.role === 'user' ? "Hear your message" : "Hear response (S)"}
                          aria-pressed={isSpeaking === i}
                        >
                          <svg className={`w-3 h-3 md:w-3.5 md:h-3.5 ${isSpeaking === i ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
                        </button>
                        {m.role === 'model' && (
                          <>
                            <button 
                              onClick={() => toggleFlag(i)}
                              className={`p-1 rounded-lg transition-colors ${m.isFlagged ? 'text-[#FFCB05] bg-[#00274C]' : 'text-[#00274C]/30 hover:text-[#00274C] hover:bg-[#00274C]/5'}`}
                              title="Flag as Important"
                            >
                              <svg className={`w-3 h-3 md:w-3.5 md:h-3.5 ${m.isFlagged ? 'fill-current' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
                            </button>
                            <button 
                              onClick={() => setFeedbackPanelIndex(feedbackPanelIndex === i ? null : i)}
                              className={`p-1 rounded-lg transition-colors ${m.feedback || feedbackPanelIndex === i ? 'text-[#FFCB05] bg-[#00274C]' : 'text-[#00274C]/30 hover:text-[#00274C] hover:bg-[#00274C]/5'}`}
                              title="Provide assessment"
                            >
                              <svg className="w-3 h-3 md:w-3.5 md:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                            </button>
                            <button 
                              onClick={() => handleDownloadAudio(m.text, i)}
                              disabled={isDownloading === i}
                              className={`p-1 rounded-lg transition-colors ${isDownloading === i ? 'text-[#FFCB05] bg-[#00274C]' : 'text-[#00274C]/30 hover:text-[#00274C] hover:bg-[#00274C]/5'}`}
                              title="Download Audio Response"
                            >
                              {isDownloading === i ? (
                                <div className="w-3 h-3 md:w-3.5 md:h-3.5 border-2 border-[#00274C] border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <svg className="w-3 h-3 md:w-3.5 md:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="leading-relaxed text-left">{m.text}</p>
                    {m.isFlagged && (
                      <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 bg-[#FFCB05] text-[#00274C] rounded-full p-1 shadow-md border-2 border-white">
                        <svg className="w-2 md:w-2.5 h-2 md:h-2.5 fill-current" viewBox="0 0 24 24"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {pendingAlternatives && !isTyping && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-px bg-[#00274C]/10 flex-grow"></div>
                  <span className="text-[10px] font-black text-[#00274C] uppercase tracking-widest px-2">Choose Response Tone</span>
                  <div className="h-px bg-[#00274C]/10 flex-grow"></div>
                </div>
                <div className={`grid gap-4 ${feedbackPanelIndex !== null || showStudyGuide ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-3'}`}>
                  {pendingAlternatives.map((alt, idx) => {
                    const isSelected = selectedAltIndex === idx;
                    const isOtherSelected = selectedAltIndex !== null && !isSelected;
                    return (
                      <div 
                        key={idx}
                        onClick={() => handleSelectAlternative(alt, idx)}
                        className={`p-5 rounded-2xl transition-all flex flex-col group relative border-4 ${
                          isSelected 
                            ? 'bg-[#FFCB05] border-[#00274C] scale-[1.02] z-10 shadow-2xl' 
                            : isOtherSelected 
                              ? 'bg-white border-transparent opacity-40 grayscale pointer-events-none'
                              : 'bg-white border-white hover:border-[#00274C] hover:shadow-xl cursor-pointer shadow-sm'
                        }`}
                      >
                        <span className={`inline-block self-start px-2.5 py-1 mb-4 rounded-md text-[9px] font-black uppercase tracking-wider transition-colors shadow-sm ${
                          isSelected ? 'bg-[#00274C] text-[#FFCB05]' : 'bg-[#FFCB05] text-[#00274C]'
                        }`}>
                          {alt.label}
                        </span>
                        <p className="text-[#00274C] text-sm leading-snug flex-grow font-medium">{alt.text}</p>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            playTTS(alt.text, `alt-${idx}`);
                          }}
                          className={`absolute bottom-3 right-3 p-1.5 rounded-lg transition-all ${isSpeaking === `alt-${idx}` ? 'bg-[#00274C] text-[#FFCB05]' : 'bg-[#00274C]/5 text-[#00274C]/30 hover:text-[#00274C] hover:bg-[#00274C]/10'}`}
                          title="Hear this option"
                        >
                          <svg className={`w-3.5 h-3.5 ${isSpeaking === `alt-${idx}` ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Undo Choice Button */}
            {!pendingAlternatives && lastAlternatives && isLastMsgModel && (
              <div className="flex justify-center animate-in fade-in duration-300">
                <button 
                  onClick={handleRevertTurn}
                  className="flex items-center gap-2 px-6 py-2 bg-white border-4 border-[#00274C] text-[#00274C] rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-[#00274C] hover:text-[#FFCB05] transition-all shadow-lg active:scale-95"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
                  Undo Choice (Return to Alternatives)
                </button>
              </div>
            )}

            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-white border border-[#00274C]/10 p-4 rounded-2xl shadow-sm flex items-center gap-3">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-[#00274C] rounded-full animate-bounce"></div>
                    <div className="w-1.5 h-1.5 bg-[#00274C] rounded-full animate-bounce delay-75"></div>
                    <div className="w-1.5 h-1.5 bg-[#00274C] rounded-full animate-bounce delay-150"></div>
                  </div>
                  <span className="text-[10px] font-black text-[#00274C]/40 uppercase tracking-widest">{persona.name} is formulating options...</span>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 md:p-6 bg-white border-t-2 border-[#00274C] shrink-0">
            <form onSubmit={handleSend} className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="relative flex-grow">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    disabled={isTyping || !!pendingAlternatives}
                    placeholder={pendingAlternatives ? "Select a response tone above..." : isListening ? "Listening..." : "Type your professional response..."}
                    className={`w-full p-3 md:p-4 pr-12 md:pr-16 bg-[#F8F9FA] rounded-xl md:rounded-2xl border-2 outline-none transition-all text-xs md:text-sm font-bold text-[#00274C] ${isListening || isRecording ? 'border-[#FFCB05] ring-4 ring-[#FFCB05]/10' : 'border-[#00274C]/10 focus:border-[#00274C]'}`}
                  />
                  <button 
                    type="submit" 
                    disabled={!inputValue.trim() || isTyping || !!pendingAlternatives} 
                    className="absolute right-1.5 top-1.5 bottom-1.5 bg-[#00274C] hover:bg-[#003d77] disabled:bg-slate-300 text-[#FFCB05] px-3 md:px-4 rounded-lg md:rounded-xl shadow-lg transition-all focus:outline-none focus:ring-2 focus:ring-[#FFCB05]"
                    aria-label="Send message"
                  >
                    <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
                  </button>
                </div>
                
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onMouseLeave={stopRecording}
                    onTouchStart={startRecording}
                    onTouchEnd={stopRecording}
                    className={`w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-all shadow-md ${isRecording ? 'bg-red-500 text-white scale-110 animate-pulse' : 'bg-[#00274C] text-[#FFCB05] hover:scale-105'}`}
                    title="Hold to record voice"
                  >
                    <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
                  </button>
                  
                  {recordedAudioUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        const audio = new Audio(recordedAudioUrl);
                        audio.play();
                      }}
                      className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-[#FFCB05] text-[#00274C] flex items-center justify-center hover:scale-105 transition-all shadow-md"
                      title="Play recorded clip"
                    >
                      <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    </button>
                  )}
                </div>
              </div>
              {recordedAudioUrl && (
                <div className="flex items-center gap-2 text-[10px] font-bold text-[#00274C]/60 italic">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
                  Voice clip recorded. Click send to include it in your message.
                  <button onClick={() => setRecordedAudioUrl(null)} className="text-red-500 hover:underline ml-2">Discard</button>
                </div>
              )}
            </form>
          </div>
        </div>

        {/* Feedback Side Panel */}
        {feedbackPanelIndex !== null && (
          <div className="absolute inset-0 lg:relative lg:inset-auto lg:w-[35%] border-l-0 lg:border-l-2 border-[#00274C]/10 flex flex-col bg-white z-30">
            <FeedbackForm 
              initialFeedback={messages[feedbackPanelIndex].feedback}
              onSave={(f) => saveFeedback(feedbackPanelIndex, f)} 
              onCancel={() => setFeedbackPanelIndex(null)} 
              messageText={messages[feedbackPanelIndex].text}
            />
          </div>
        )}

        {/* Study Guide Side Panel */}
        {showStudyGuide && (
          <div className="absolute inset-0 lg:relative lg:inset-auto lg:w-[35%] border-l-0 lg:border-l-2 border-[#00274C]/10 flex flex-col bg-white z-30 animate-in slide-in-from-right duration-300">
            <div className="p-4 md:p-6 border-b border-[#00274C]/10 flex items-center justify-between bg-white sticky top-0 z-10">
              <h3 className="text-xs md:text-sm font-black text-[#00274C] uppercase tracking-widest">Study Guide</h3>
              <div className="flex items-center gap-2">
                {flaggedMessages.length > 0 && (
                  <button 
                    onClick={handleDownloadStudyGuide}
                    className="p-1.5 md:p-2 bg-[#FFCB05] text-[#00274C] rounded-lg hover:bg-[#00274C] hover:text-[#FFCB05] transition-all shadow-sm active:scale-95"
                    title="Download Study Guide as HTML"
                  >
                    <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  </button>
                )}
                <button onClick={() => setShowStudyGuide(false)} className="text-[#00274C]/30 hover:text-[#00274C] transition-colors p-1">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div className="flex-grow overflow-y-auto p-4 md:p-6 space-y-4 bg-[#F8F9FA] custom-scrollbar">
              {flaggedMessages.length === 0 ? (
                <div className="text-center py-12 space-y-4">
                  <div className="w-12 h-12 md:w-16 md:h-16 bg-[#00274C]/5 rounded-full flex items-center justify-center mx-auto">
                    <svg className="w-6 h-6 md:w-8 md:h-8 text-[#00274C]/20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
                  </div>
                  <p className="text-[10px] md:text-xs font-bold text-[#00274C]/40 uppercase tracking-widest">No study points flagged yet</p>
                  <p className="text-[9px] md:text-[10px] text-slate-500 leading-relaxed italic px-4">Flag insightful AI responses during the session to review them here.</p>
                </div>
              ) : (
                flaggedMessages.map((m, idx) => (
                  <div key={idx} className="bg-white p-3 md:p-4 rounded-xl border border-[#FFCB05] shadow-sm space-y-2 md:space-y-3 relative group">
                    <button 
                      onClick={() => toggleFlag(messages.indexOf(m))}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-red-50 text-red-500 rounded-md hover:bg-red-500 hover:text-white"
                      title="Remove from Guide"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] md:text-[9px] font-black uppercase text-[#00274C]/40 tracking-widest">Key Point #{idx + 1}</span>
                    </div>
                    <p className="text-[11px] md:text-xs font-medium text-[#00274C] leading-relaxed italic">"{m.text}"</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #00274C20; border-radius: 10px; }`}</style>
      {showPostSessionFeedback && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-xl w-full text-center space-y-6">
            <h2 className="text-2xl font-black text-[#00274C] uppercase tracking-widest">Session Complete</h2>
            <p className="text-slate-600">Your session has been recorded and exported. Please provide some brief feedback on your experience.</p>
            <div className="p-6 bg-[#F8F9FA] rounded-2xl border-2 border-[#00274C]/10 text-left">
              <label className="block text-[10px] font-black text-[#00274C] uppercase tracking-widest mb-2">Overall Quality</label>
              <div className="flex gap-2 mb-4">
                {[1,2,3,4,5].map(v => (
                  <button key={v} className="w-10 h-10 rounded-lg border-2 border-[#00274C]/20 hover:border-[#FFCB05] hover:bg-[#FFCB05]/10 flex items-center justify-center font-bold text-[#00274C]">{v}</button>
                ))}
              </div>
              <label className="block text-[10px] font-black text-[#00274C] uppercase tracking-widest mb-2">Comments</label>
              <textarea className="w-full p-4 rounded-xl border-2 border-[#00274C]/10 outline-none focus:border-[#00274C]" rows={4} placeholder="How was the simulation?"></textarea>
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
