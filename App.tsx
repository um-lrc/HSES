
import React, { useState, useEffect, useRef } from 'react';
import localforage from 'localforage';
import { motion, AnimatePresence } from 'motion/react';
import { PERSONAS } from './constants';
import { Persona, SessionState, Scenario, Message } from './types';
import { Info, Plus, Upload, ChevronDown, ChevronUp } from 'lucide-react';
import { PersonaProfileModal } from './components/PersonaProfileModal';
import { VoiceMode } from './components/VoiceMode';
import { TextMode } from './components/TextMode';
import { TeacherMode } from './components/TeacherMode';
import { SettingsModal } from './components/SettingsModal';
import { InfoModal } from './components/InfoModal';
import { RequestPersonModal } from './components/RequestPersonModal';
import { RequestScenarioModal } from './components/RequestScenarioModal';
import { parseSessionJson } from './services/reportUtils';
import { speakText, stopSpeech } from './services/ttsService';

const App: React.FC = () => {
  const [personas, setPersonas] = useState<Persona[]>(PERSONAS);
  const [isTeacherModeOpen, setIsTeacherModeOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isRequestPersonModalOpen, setIsRequestPersonModalOpen] = useState(false);
  const [isRequestScenarioModalOpen, setIsRequestScenarioModalOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isRubricExpanded, setIsRubricExpanded] = useState(false);
  const [instructorEmail, setInstructorEmail] = useState("sintjago@umich.edu");
  const [selectedPersonaForProfile, setSelectedPersonaForProfile] = useState<Persona | null>(null);
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [isProtocolOpen, setIsProtocolOpen] = useState(false);
  const [isFaqOpen, setIsFaqOpen] = useState(false);

  const [session, setSession] = useState<SessionState>({
    isActive: false,
    mode: 'text',
    persona: null,
    scenario: null,
    requestFeedback: true,
    messages: [],
    isTyping: false,
    isListening: false,
    isSpeaking: false,
    transcript: '',
    showTranscript: false,
    feedback: null,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Global shortcuts for App (only when no session is active)
      if (session.isActive) return;

      // Check if any modal is open
      const isAnyModalOpen = isTeacherModeOpen || isPasswordModalOpen || isSettingsOpen || 
                            isInfoModalOpen || isProfileModalOpen || isRequestPersonModalOpen || 
                            isRequestScenarioModalOpen;

      if (isAnyModalOpen) {
        if (e.key === 'Escape') {
          setIsPasswordModalOpen(false);
          setIsSettingsOpen(false);
          setIsInfoModalOpen(false);
          setIsProfileModalOpen(false);
          setIsRequestPersonModalOpen(false);
          setIsRequestScenarioModalOpen(false);
          // TeacherMode has its own close logic but we can trigger it too
          setIsTeacherModeOpen(false);
        }
        return;
      }

      if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setIsInfoModalOpen(true);
      } else if (e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setIsSettingsOpen(true);
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsPasswordModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session.isActive, isTeacherModeOpen, isPasswordModalOpen, isSettingsOpen, isInfoModalOpen, isProfileModalOpen, isRequestPersonModalOpen, isRequestScenarioModalOpen]);
  
  const [portraits, setPortraits] = useState<Record<string, string>>({});
  const [portraitsLoaded, setPortraitsLoaded] = useState(false);

  // Helper to get portrait with override support
  const getPortrait = (personaId: string) => {
    if (portraits[personaId]) return portraits[personaId];
    return `./portraits/${personaId}.png`;
  };

  useEffect(() => {
    const loadPortraits = async () => {
      try {
        const saved = await localforage.getItem<Record<string, string>>('portraits');
        if (saved) {
          setPortraits(saved);
        }
      } catch (e) {
        console.error("Failed to load portraits from localforage", e);
      } finally {
        setPortraitsLoaded(true);
      }
    };
    loadPortraits();
  }, []);

  useEffect(() => {
    if (portraitsLoaded) {
      localforage.setItem('portraits', portraits).catch(e => {
        console.error("Failed to save portraits to localforage", e);
      });
    }
  }, [portraits, portraitsLoaded]);

  useEffect(() => {
    if (!activePersonaId && personas.length > 0) {
      setActivePersonaId(personas[0].id);
    }
  }, [personas, activePersonaId]);

  const [hasSavedSession, setHasSavedSession] = useState(false);

  useEffect(() => {
    const checkSavedSession = async () => {
      const saved = await localforage.getItem('high_stakes_session');
      setHasSavedSession(!!saved);
    };
    checkSavedSession();
  }, [session.isActive]);

  const resumeSession = async () => {
    try {
      const saved = await localforage.getItem<SessionState>('high_stakes_session');
      if (saved) {
        setSession({ ...saved, isActive: true });
      }
    } catch (err) {
      console.error("Failed to resume session", err);
    }
  };

  // Handle clicks outside of dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectPersona = (persona: Persona) => {
    setSession({ ...session, persona, scenario: null });
  };

  const handleShowProfile = (persona: Persona) => {
    setSelectedPersonaForProfile(persona);
    setIsProfileModalOpen(true);
  };

  const handleSelectScenario = (scenario: Scenario) => {
    setSession({ ...session, scenario });
  };

  const startSession = (mode: 'text' | 'voice') => {
    setSession({ ...session, isActive: true, mode });
  };

  const endSession = () => {
    setSession({ ...session, isActive: false, persona: null, scenario: null });
  };

  const resetToPersona = () => {
    setSession({ ...session, persona: null, scenario: null });
  };

  const resetToScenario = () => {
    setSession({ ...session, scenario: null });
  };

  const handleUpdatePersonas = (newPersonas: Persona[]) => {
    setPersonas(newPersonas);
    // We don't close automatically so they can see the success message
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === 'LanguageLearning1!') {
      setIsPasswordModalOpen(false);
      setIsTeacherModeOpen(true);
      setPasswordInput("");
      setPasswordError(false);
    } else {
      setPasswordError(true);
    }
  };

  const handleResumeSession = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const sessionData = parseSessionJson(text);
      
      // Find the persona in our current list to ensure we have the latest data/methods if any
      const currentPersona = personas.find(p => p.id === sessionData.persona.id) || sessionData.persona;
      
      setSession({
        isActive: true,
        mode: sessionData.mode,
        persona: currentPersona,
        scenario: sessionData.scenario,
        initialMessages: sessionData.messages
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to parse session file");
    }
    // Reset input
    e.target.value = '';
  };

  if (session.isActive && session.persona && session.scenario) {
    return (
      <div className="h-screen w-full bg-[#E8EAED] p-4 md:p-10 flex items-center justify-center">
        <div className="w-full max-w-5xl h-full max-h-[900px]">
          {session.mode === 'voice' ? (
            <VoiceMode 
              persona={session.persona} 
              scenario={session.scenario} 
              onExit={endSession} 
              portraits={portraits}
              setPortraits={setPortraits}
              initialMessages={session.initialMessages}
              requestFeedback={session.requestFeedback}
            />
          ) : (
            <TextMode 
              persona={session.persona} 
              scenario={session.scenario} 
              onExit={endSession} 
              portraits={portraits}
              setPortraits={setPortraits}
              initialMessages={session.initialMessages}
              requestFeedback={session.requestFeedback}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {isPasswordModalOpen && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="faculty-modal-title"
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-[#00274C] p-6 flex justify-between items-center">
              <h2 id="faculty-modal-title" className="text-lg font-black text-white uppercase tracking-widest">Faculty Access</h2>
              <button 
                onClick={() => { setIsPasswordModalOpen(false); setPasswordInput(""); setPasswordError(false); }} 
                className="text-white/60 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#FFCB05]"
                aria-label="Close Faculty Access"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <form onSubmit={handlePasswordSubmit} className="p-8 space-y-6">
              <div className="space-y-2">
                <label htmlFor="faculty-password" className="text-xs font-bold text-[#00274C] uppercase tracking-wider">Enter Password</label>
                <input 
                  id="faculty-password"
                  type="password" 
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-[#FFCB05] outline-none transition-colors"
                  placeholder="••••••••"
                  autoFocus
                />
                {passwordError && <p className="text-red-500 text-xs font-bold" role="alert">Incorrect password. Please try again.</p>}
              </div>
              <button 
                type="submit"
                className="w-full bg-[#00274C] text-[#FFCB05] py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#003d77] transition-colors shadow-md focus:outline-none focus:ring-4 focus:ring-[#FFCB05]/50"
              >
                Unlock Faculty Mode
              </button>
            </form>
          </div>
        </div>
      )}

      {isTeacherModeOpen && (
        <TeacherMode 
          personas={personas} 
          onUpdatePersonas={handleUpdatePersonas} 
          onClose={() => setIsTeacherModeOpen(false)} 
          instructorEmail={instructorEmail}
          onUpdateInstructorEmail={setInstructorEmail}
          portraits={portraits}
          setPortraits={setPortraits}
        />
      )}
      <header className="bg-[#00274C] border-b border-[#FFCB05] sticky top-0 z-20 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-2 md:py-6 flex flex-col lg:flex-row items-center justify-between gap-2 md:gap-6">
          <div className="flex items-center gap-2 md:gap-4 shrink-0">
            <div className="w-7 h-7 md:w-12 md:h-12 bg-[#FFCB05] rounded-lg md:rounded-xl flex items-center justify-center shadow-lg border-2 border-white/20">
              <svg className="w-4 h-4 md:w-7 md:h-7 text-[#00274C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"></path></svg>
            </div>
            <div>
              <h1 className="text-sm md:text-xl font-black text-white tracking-tight leading-none mb-0.5 md:mb-1 uppercase">High Stakes</h1>
              <p className="text-[7px] md:text-[10px] font-bold text-[#FFCB05] uppercase tracking-widest">English Simulator</p>
            </div>
          </div>
          <div className="w-full lg:max-w-3xl text-white/90 text-[10px] md:text-sm font-medium text-center lg:text-right leading-relaxed italic border-t lg:border-t-0 lg:border-r-4 border-[#FFCB05] pt-1.5 lg:pt-0 lg:pr-6 flex flex-col lg:items-end gap-1 md:gap-2">
            <div className="hidden sm:flex items-center gap-2">
              <span>This tool helps international scholars navigate institutional hierarchies and professional challenges with confidence.</span>
              <button 
                onClick={() => speakText("This tool helps international scholars navigate institutional hierarchies and professional challenges with confidence.", "Zephyr")}
                className="p-1 hover:bg-white/10 rounded-full transition-colors"
                title="Listen"
              >
                <svg className="w-3 h-3 text-[#FFCB05]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
              </button>
              <span className="text-[#FFCB05] font-black ml-2 uppercase text-[9px] md:text-[10px] tracking-widest not-italic">Simulate. Review. Succeed.</span>
            </div>
            <div className="flex items-center justify-center lg:justify-end gap-2 md:gap-4">
              <button 
                onClick={() => setIsInfoModalOpen(true)}
                className="text-[#FFCB05]/60 hover:text-[#FFCB05] text-[8px] md:text-[10px] uppercase font-bold tracking-widest flex items-center gap-1 transition-colors focus:outline-none focus:ring-2 focus:ring-[#FFCB05] rounded px-1"
                aria-label="Information (I)"
              >
                <svg className="w-2.5 h-2.5 md:w-3 md:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                Info
              </button>
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="text-[#FFCB05]/60 hover:text-[#FFCB05] text-[8px] md:text-[10px] uppercase font-bold tracking-widest flex items-center gap-1 transition-colors focus:outline-none focus:ring-2 focus:ring-[#FFCB05] rounded px-1"
                aria-label="Settings (G)"
              >
                <svg className="w-2.5 h-2.5 md:w-3 md:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                Settings
              </button>
              <button 
                onClick={() => setIsPasswordModalOpen(true)}
                className="text-[#FFCB05]/60 hover:text-[#FFCB05] text-[8px] md:text-[10px] uppercase font-bold tracking-widest flex items-center gap-1 transition-colors focus:outline-none focus:ring-2 focus:ring-[#FFCB05] rounded px-1"
                aria-label="Faculty Access (F)"
              >
                <svg className="w-2.5 h-2.5 md:w-3 md:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                Faculty
              </button>
            </div>
          </div>
        </div>
      </header>

      {isSettingsOpen && (
        <SettingsModal 
          onClose={() => setIsSettingsOpen(false)}
          portraits={portraits}
          personas={personas}
        />
      )}

      {isInfoModalOpen && (
        <InfoModal onClose={() => setIsInfoModalOpen(false)} />
      )}

      {isRequestPersonModalOpen && (
        <RequestPersonModal 
          onClose={() => setIsRequestPersonModalOpen(false)} 
          instructorEmail={instructorEmail}
        />
      )}

      {isRequestScenarioModalOpen && (
        <RequestScenarioModal 
          isOpen={isRequestScenarioModalOpen} 
          onClose={() => setIsRequestScenarioModalOpen(false)} 
          instructorEmail={instructorEmail}
        />
      )}

      <PersonaProfileModal 
        persona={selectedPersonaForProfile}
        portrait={selectedPersonaForProfile ? getPortrait(selectedPersonaForProfile.id) : undefined}
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />

      <main className="flex-grow max-w-7xl mx-auto px-4 md:px-6 py-2 md:py-6 w-full">
        {!session.persona ? (
          <div className="space-y-4 md:space-y-8">
            {/* Unified Persona Selector */}
            <div className="space-y-4 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom duration-500 pb-6">
              <div className="relative group" ref={dropdownRef}>
                <label className="block text-[9px] md:text-[10px] font-black text-[#00274C] uppercase tracking-widest mb-2 ml-1">Select chatbot</label>
                <div className="relative">
                  <button
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="w-full bg-[#00274C] text-[#FFCB05] font-black uppercase tracking-widest text-xs md:text-sm p-3 md:p-4 rounded-xl shadow-xl border-4 border-transparent hover:border-[#FFCB05]/30 transition-all flex items-center justify-between text-left focus:outline-none focus:ring-4 focus:ring-[#FFCB05]/20"
                  >
                    <span className="truncate">
                      {personas.find(p => p.id === activePersonaId)?.title || 'Select persona'}
                    </span>
                    <svg className={`w-5 h-5 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"/>
                    </svg>
                  </button>

                  <AnimatePresence>
                    {isDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.95 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="absolute z-50 w-full mt-2 bg-[#00274C] border-2 border-[#FFCB05]/30 rounded-xl shadow-2xl overflow-hidden"
                      >
                        <div className="max-h-60 overflow-y-auto custom-scrollbar">
                          {personas.map(p => (
                            <button
                              key={p.id}
                              onClick={() => {
                                setActivePersonaId(p.id);
                                setIsDropdownOpen(false);
                              }}
                              className={`w-full text-left p-4 hover:bg-[#FFCB05]/10 transition-colors border-b border-[#FFCB05]/10 last:border-0 flex flex-col gap-1 ${activePersonaId === p.id ? 'bg-[#FFCB05]/5' : ''}`}
                            >
                              <span className={`text-[10px] md:text-xs font-black uppercase tracking-wider ${activePersonaId === p.id ? 'text-[#FFCB05]' : 'text-[#FFCB05]/80'}`}>
                                {p.title}
                              </span>
                              <span className="text-xs md:text-sm font-black text-white uppercase tracking-widest">
                                {p.name}
                              </span>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {personas.filter(p => p.id === activePersonaId).map(p => (
                <div key={p.id} className="bg-white rounded-2xl md:rounded-[2rem] shadow-2xl border-2 border-slate-100 overflow-hidden group animate-in zoom-in-95 duration-300">
                  <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-100">
                    {/* Portrait Section */}
                    <div className="md:w-2/5 p-6 md:p-8 flex flex-col items-center justify-center bg-slate-50 relative overflow-hidden">
                      <div className="absolute -top-10 -left-10 w-40 h-40 bg-[#FFCB05]/10 rounded-full blur-3xl"></div>
                      <div className="w-32 h-32 md:w-64 md:h-64 rounded-2xl md:rounded-[2.5rem] bg-white shadow-2xl border-4 md:border-8 border-white overflow-hidden relative z-10 transition-transform duration-500 group-hover:scale-105">
                        <img src={getPortrait(p.id)} alt={p.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="mt-3 md:mt-6 text-center relative z-10 font-bold uppercase tracking-widest text-[#00274C]">
                         <h3 className="text-xl md:text-2xl font-black tracking-tight mb-0.5">{p.name}</h3>
                         <p className="text-[8px] md:text-[10px] opacity-60 leading-none">{p.title}</p>
                         
                         <div className="flex flex-wrap items-center justify-center gap-3 mt-2 md:mt-4">
                           <button 
                            onClick={() => handleShowProfile(p)}
                            className="inline-flex items-center gap-1.5 text-[#00274C]/60 hover:text-[#00274C] transition-colors font-black uppercase tracking-widest text-[8px] md:text-[9px] border-b border-transparent hover:border-[#00274C]"
                          >
                            <Info className="w-3 h-3" />
                            Learn More about {p.name.split(' ').pop()}
                          </button>

                          {hasSavedSession && (
                            <button 
                              onClick={resumeSession}
                              className="inline-flex items-center gap-1.5 text-[#00274C]/60 hover:text-[#00274C] transition-colors font-black uppercase tracking-widest text-[8px] md:text-[9px] border-b border-transparent hover:border-[#00274C]"
                            >
                              <Upload className="w-3 h-3" />
                              Resume
                            </button>
                          )}
                         </div>
                      </div>
                    </div>

                    {/* Info Section */}
                    <div className="md:w-3/5 p-5 md:p-8 flex flex-col justify-center space-y-4 md:space-y-6">
                      <div className="space-y-2 md:space-y-3">
                        <div className="flex items-center gap-2">
                           <div className="w-1 h-5 bg-[#FFCB05] rounded-full" />
                           <h4 className="text-[9px] md:text-[10px] font-black text-[#00274C] uppercase tracking-widest">Character Context</h4>
                        </div>
                        <p className="text-slate-600 text-xs md:text-sm leading-relaxed font-semibold">
                          {p.description}
                        </p>
                      </div>

                      <div className="bg-[#00274C]/5 rounded-xl md:rounded-2xl p-4 md:p-6 space-y-3 border border-[#00274C]/5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-[#00274C] flex items-center justify-center text-[#FFCB05]">
                              <svg className="w-3 h-3 md:w-3.5 md:h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" /></svg>
                            </div>
                            <span className="text-[9px] md:text-[10px] font-black text-[#00274C] uppercase tracking-widest">Grading Rubric</span>
                          </div>
                          
                          {p.rubric && (
                            <button 
                              onClick={() => setIsRubricExpanded(!isRubricExpanded)}
                              className="flex items-center gap-1 text-[8px] md:text-[9px] font-black text-[#00274C]/60 hover:text-[#00274C] uppercase tracking-widest transition-colors"
                            >
                              {isRubricExpanded ? 'Hide' : 'Show'} Rubric
                              {isRubricExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                          )}
                        </div>
                        <p className="text-xs md:text-base text-[#00274C] leading-snug italic font-serif">"{p.goal}"</p>
                        
                        <AnimatePresence>
                          {isRubricExpanded && p.rubric && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="pt-3 space-y-2 border-t border-[#00274C]/10 mt-2">
                                {p.rubric.map((item, idx) => (
                                  <div key={idx} className="flex justify-between items-start group/rubric hover:bg-[#00274C]/5 p-1 rounded transition-colors">
                                    <div className="flex gap-2 items-start">
                                      <div className="w-1.5 h-1.5 rounded-full bg-[#FFCB05] mt-1.5 shrink-0" />
                                      <span className="text-[10px] md:text-xs text-slate-700 font-medium leading-tight">{item.criterion}</span>
                                    </div>
                                    <span className="text-[9px] md:text-[11px] font-black text-[#00274C] whitespace-nowrap ml-2">
                                      {item.points} pts
                                    </span>
                                  </div>
                                ))}
                                <div className="pt-2 border-t border-dashed border-[#00274C]/10 flex justify-between items-center text-[#00274C] font-black uppercase tracking-widest text-[10px]">
                                  <span>Total Weight</span>
                                  <span>{p.rubric.reduce((acc, item) => acc + item.points, 0)} pts</span>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3">
                        <button 
                          onClick={() => handleSelectPersona(p)}
                          className="w-full bg-[#00274C] text-[#FFCB05] py-3 md:py-4 rounded-xl font-black text-xs md:text-sm uppercase tracking-[0.2em] hover:bg-[#003d77] transition-all shadow-xl active:scale-95 flex items-center justify-center gap-2 group/btn"
                        >
                          Initiate Conversation
                          <svg className="w-4 h-4 transition-transform group-hover/btn:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              <div className="pt-8 border-t border-slate-100 flex justify-center">
                <button 
                  onClick={() => setIsRequestPersonModalOpen(true)}
                  className="inline-flex items-center gap-2 text-[#00274C] font-black uppercase tracking-[0.2em] text-[10px] md:text-xs py-3 px-6 rounded-xl border-2 border-transparent hover:border-[#00274C]/20 transition-all bg-slate-50"
                >
                  <Plus className="w-4 h-4" />
                  Request New Person
                </button>
              </div>
            </div>

          </div>
        ) : !session.scenario ? (
          <div className="max-w-4xl mx-auto space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom duration-500">
            <button onClick={resetToPersona} className="flex items-center gap-2 text-[#00274C]/60 hover:text-[#00274C] transition-colors font-bold text-[9px] md:text-sm uppercase tracking-wider">
              <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"/></svg>
              Back to People
            </button>

            <div className="text-center space-y-1 md:space-y-2">
              <h2 className="text-xl md:text-3xl font-black text-[#00274C] tracking-tight uppercase">Select Your Challenge</h2>
              <p className="text-[10px] md:text-sm text-slate-500 font-medium">Choose a high-stakes scenario to practice with {session.persona.name}.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              {session.persona.scenarios.map(s => (
                <div 
                  key={s.id} 
                  className="bg-white border-2 md:border-4 border-slate-50 hover:border-[#FFCB05] rounded-xl md:rounded-2xl p-4 md:p-6 cursor-pointer transition-all hover:shadow-xl group relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-16 h-16 md:w-24 md:h-24 bg-[#FFCB05]/10 rounded-bl-full translate-x-8 -translate-y-8 group-hover:scale-150 transition-transform"></div>
                  <div className="flex justify-between items-start relative z-10">
                    <h3 className="text-lg md:text-xl font-black text-[#00274C] mb-2 md:mb-3">{s.title}</h3>
                    <button 
                      onClick={(e) => { e.stopPropagation(); speakText(s.context, session.persona?.voiceName || "Kore"); }}
                      className="p-2 hover:bg-[#00274C]/5 rounded-full transition-colors"
                      title="Listen to scenario"
                    >
                      <svg className="w-5 h-5 text-[#00274C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
                    </button>
                  </div>
                  <p className="text-slate-600 text-xs md:text-sm leading-relaxed mb-4 md:mb-6 relative z-10">{s.context}</p>
                  <div 
                    onClick={() => handleSelectScenario(s)}
                    className="flex items-center gap-2 text-[9px] md:text-[10px] font-black text-[#00274C] uppercase tracking-widest bg-[#FFCB05] self-start px-3 md:px-4 py-1.5 md:py-2 rounded-lg md:rounded-xl shadow-sm relative z-10"
                  >
                    <span>Initiate Scenario</span>
                    <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-center pt-4">
              <button 
                onClick={() => setIsRequestScenarioModalOpen(true)}
                className="text-[#00274C] font-black uppercase tracking-widest text-[10px] md:text-xs border-2 border-[#00274C] px-6 py-3 rounded-xl hover:bg-[#00274C] hover:text-[#FFCB05] transition-all active:scale-95"
              >
                Request New Scenario
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom duration-500">
            <button onClick={resetToScenario} className="flex items-center gap-2 text-[#00274C]/60 hover:text-[#00274C] transition-colors font-bold text-xs md:text-sm uppercase tracking-wider">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"/></svg>
              Change Scenario
            </button>

            <div className="bg-white rounded-[1.2rem] md:rounded-[2rem] p-4 md:p-8 shadow-2xl border-b-4 md:border-b-8 border-[#FFCB05] flex flex-col md:flex-row gap-4 md:gap-8 items-center relative overflow-hidden">
              <div className="absolute -top-10 -right-10 w-64 h-64 bg-[#00274C]/5 rounded-full blur-3xl"></div>
              
              <div className="w-20 h-20 md:w-44 md:h-44 flex-shrink-0 z-10 flex items-center justify-center bg-white rounded-[1rem] md:rounded-[1.5rem] shadow-2xl border-2 md:border-4 border-white text-[2rem] md:text-[5rem] overflow-hidden">
                <img src={getPortrait(session.persona.id)} alt={session.persona.name} className="w-full h-full object-cover" />
              </div>
              <div className="space-y-1 md:space-y-4 flex-grow z-10 text-center md:text-left">
                <div>
                  <h2 className="text-lg md:text-2xl font-black text-[#00274C] tracking-tight">{session.persona.name}</h2>
                  <p className="text-[#00274C]/60 font-black uppercase tracking-widest text-[7px] md:text-[9px] mb-1">{session.persona.title}</p>
                  <div className="inline-block px-2 py-0.5 md:px-3 md:py-1.5 bg-[#00274C] text-[#FFCB05] rounded-lg md:rounded-xl text-[7px] md:text-[9px] font-black uppercase tracking-widest shadow-md">
                    Target: {session.scenario.title}
                  </div>
                </div>
                
                <div className="flex items-start gap-2 group/brief">
                  <p className="text-slate-700 leading-relaxed italic text-[10px] md:text-base font-medium border-l-4 md:border-l-6 border-[#FFCB05] pl-3 md:pl-4 py-1 flex-grow">
                    "{session.scenario.context}"
                  </p>
                  <button 
                    onClick={() => speakText(session.scenario?.context || "", session.persona?.voiceName || "Kore")}
                    className="mt-1 p-1.5 hover:bg-[#00274C]/5 rounded-full transition-colors opacity-0 group-hover/brief:opacity-100"
                    title="Listen to context"
                  >
                    <svg className="w-4 h-4 text-[#00274C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
                  </button>
                </div>
                
                <div className="flex flex-col gap-4 pt-1 md:pt-4">
                  <div className="flex items-center gap-2 bg-white/50 p-2 md:p-3 rounded-lg border border-[#00274C]/10 self-center sm:self-start">
                    <input 
                      type="checkbox" 
                      id="request-feedback" 
                      checked={session.requestFeedback}
                      onChange={(e) => setSession({ ...session, requestFeedback: e.target.checked })}
                      className="w-4 h-4 md:w-5 md:h-5 accent-[#00274C] cursor-pointer"
                    />
                    <label htmlFor="request-feedback" className="text-[9px] md:text-xs font-black text-[#00274C] uppercase tracking-wider cursor-pointer">
                      Provide feedback after the conversation
                    </label>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 md:gap-4">
                    <button 
                      onClick={() => startSession('text')}
                      className="flex-1 bg-white border-2 border-[#00274C] text-[#00274C] py-2 md:py-3 px-4 md:px-6 rounded-lg md:rounded-xl font-black uppercase tracking-widest text-[7px] md:text-[10px] transition-all flex items-center justify-center gap-2 shadow-sm hover:bg-[#00274C] hover:text-[#FFCB05] active:scale-95"
                    >
                      <svg className="w-3.5 h-3.5 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
                      Turn-based Text
                    </button>
                    <button 
                      onClick={() => startSession('voice')}
                      className="flex-1 bg-[#00274C] text-[#FFCB05] py-2 md:py-3 px-4 md:px-6 rounded-lg md:rounded-xl font-black uppercase tracking-widest text-[7px] md:text-[10px] transition-all flex items-center justify-center gap-2 shadow-xl hover:bg-[#003d77] active:scale-95 border-2 border-[#00274C]"
                    >
                      <svg className="w-3.5 h-3.5 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                      Real-time Voice
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="bg-[#00274C] border-t-8 border-[#FFCB05] pt-12 pb-12 shrink-0 text-white relative">
        <div className="max-w-7xl mx-auto px-6 space-y-6">
          {/* How To Use */}
          <section className="border-b border-white/10 pb-6">
            <div className="flex items-center justify-between">
              <button 
                onClick={() => setIsProtocolOpen(!isProtocolOpen)}
                className="flex items-center gap-4 text-[#FFCB05] font-black uppercase tracking-[0.2em] text-xs py-2 hover:opacity-80 transition-opacity"
              >
                <svg className={`w-4 h-4 transition-transform ${isProtocolOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
                Training Protocol
              </button>
              <button 
                onClick={() => {
                  const text = "Training Protocol. Step 1: Choose Person. Select a professional or academic authority. Step 2: Set Context. Define the high-stakes situation for simulation. Step 3: Engage. Converse via Text (deliberate) or Voice (natural flow). Step 4: Study and Save. Flag key AI responses and download your Portfolio to share with your instructor.";
                  speakText(text, "Zephyr");
                }}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
                title="Listen to Training Protocol"
              >
                <svg className="w-4 h-4 text-[#FFCB05]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
              </button>
            </div>
            {isProtocolOpen && (
              <div className="mt-8 animate-in fade-in slide-in-from-top-4 duration-300">
                <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                  {[
                    { step: '01', title: 'Choose Person', text: 'Select a professional or academic authority.' },
                    { step: '02', title: 'Set Context', text: 'Define the high-stakes situation for simulation.' },
                    { step: '03', title: 'Engage', text: 'Converse via Text (deliberate) or Voice (natural flow).' },
                    { step: '04', title: 'Study & Save', text: 'Flag key AI responses and download your Portfolio (Audio/Transcript) to share with your instructor.' }
                  ].map((item, idx) => (
                    <li key={idx} className="flex gap-4">
                      <span className="text-[#FFCB05] font-black text-xs pt-1">{item.step}</span>
                      <div>
                        <h4 className="font-black uppercase text-[11px] mb-1 tracking-wider">{item.title}</h4>
                        <p className="text-white/60 text-xs leading-relaxed">{item.text}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* FAQ */}
          <section className="border-b border-white/10 pb-6">
            <div className="flex items-center justify-between">
              <button 
                onClick={() => setIsFaqOpen(!isFaqOpen)}
                className="flex items-center gap-4 text-[#FFCB05] font-black uppercase tracking-[0.2em] text-xs py-2 hover:opacity-80 transition-opacity"
              >
                <svg className={`w-4 h-4 transition-transform ${isFaqOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
                FAQ
              </button>
              <button 
                onClick={() => {
                  const text = "Frequently Asked Questions. Can I save my results? Yes. Use the Portfolio button to generate a full transcript. How do I share with an instructor? Click the Share button during or after a session. What is the Study Guide? Click the flag icon on any AI response. Can I download the audio? In Text Mode, you can download specific AI responses. In Voice Mode, the full interaction is saved. Is the AI feedback real? The personas use Google Gemini to provide contextually accurate responses. Is my data secure? Voice processing is encrypted in transit and transient.";
                  speakText(text, "Zephyr");
                }}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
                title="Listen to FAQ"
              >
                <svg className="w-4 h-4 text-[#FFCB05]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
              </button>
            </div>
            {isFaqOpen && (
              <div className="mt-8 animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-8">
                  {[
                    { q: 'Can I save my results?', a: 'Yes. Use the "Portfolio" button to generate a full transcript. In Voice Mode, the system records the entire session for download.' },
                    { q: 'How do I share with an instructor?', a: 'Click the "Share" button during or after a session to automatically draft an email to your instructor with the scenario details.' },
                    { q: 'What is the Study Guide?', a: 'Click the flag icon on any AI response. These "Key Points" are collected for later study to help you learn professional linguistic patterns.' },
                    { q: 'Can I download the audio?', a: 'In Text Mode, you can download specific AI responses as high-quality WAV files. In Voice Mode, the full interaction is saved as a WebM file.' },
                    { q: 'Is the AI feedback real?', a: 'The personas use Google Gemini to provide contextually accurate responses based on professional academic etiquette.' },
                    { q: 'Is my data secure?', a: 'Voice processing is encrypted in transit and transient. We do not store your private audio data after the session ends.' }
                  ].map((item, idx) => (
                    <div key={idx} className="space-y-2">
                      <h4 className="font-bold text-[#FFCB05] text-[13px]">{item.q}</h4>
                      <p className="text-white/70 text-xs leading-relaxed">{item.a}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
        
        <div className="max-w-7xl mx-auto px-6 pt-12 flex flex-col md:flex-row justify-center items-center gap-6">
          <div className="text-white/40 text-[10px] font-black uppercase tracking-[0.3em]">
            © 2026 HIGH STAKES ENGLISH SIMULATOR
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
