import React, { useState, useRef } from 'react';
import { Persona, PersonaType, Scenario } from '../types';
import * as XLSX from 'xlsx';

interface TeacherModeProps {
  personas: Persona[];
  onUpdatePersonas: (personas: Persona[]) => void;
  onClose: () => void;
  instructorEmail: string;
  onUpdateInstructorEmail: (email: string) => void;
  portraits: Record<string, string>;
  setPortraits: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export const TeacherMode: React.FC<TeacherModeProps> = ({ 
  personas, 
  onUpdatePersonas, 
  onClose, 
  instructorEmail, 
  onUpdateInstructorEmail,
  portraits,
  setPortraits
}) => {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState(instructorEmail);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const portraitFileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  const handleEmailSave = () => {
    onUpdateInstructorEmail(emailInput);
    setSuccess("Instructor email updated successfully.");
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleUploadClick = (personaId: string) => {
    portraitFileInputRefs.current[personaId]?.click();
  };

  const handleFileChange = (personaId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setPortraits(prev => ({
          ...prev,
          [personaId]: base64String
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDownload = (personaId: string, personaName: string) => {
    const image = portraits[personaId];
    if (image) {
      const link = document.createElement('a');
      link.href = image;
      link.download = `${personaId}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleDownloadAll = async () => {
    const portraitEntries = Object.entries(portraits);
    if (portraitEntries.length === 0) return;

    setSuccess(`Starting download of ${portraitEntries.length} portraits...`);
    
    for (let i = 0; i < portraitEntries.length; i++) {
      const [id, image] = portraitEntries[i];
      const persona = personas.find(p => p.id === id);
      if (persona && typeof image === 'string') {
        const link = document.createElement('a');
        link.href = image;
        link.download = `${persona.id}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Small delay to prevent browser blocking multiple downloads
        if (i < portraitEntries.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }
    }
    
    setSuccess("All available portraits downloaded.");
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleExportPersonaFile = () => {
    // Export the entire configuration to ensure nothing is lost
    const data = JSON.stringify({ 
      portraits,
      personas,
      instructorEmail,
      exportDate: new Date().toISOString(),
      version: "1.1"
    }, null, 2);
    
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `academic_simulator_config_${new Date().toISOString().split('T')[0]}.persona`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    setSuccess("Configuration exported successfully.");
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleImportPersonaFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);
        
        if (data && data.portraits) {
          setPortraits(prev => ({ ...prev, ...data.portraits }));
          
          if (data.personas) {
            onUpdatePersonas(data.personas);
          }
          
          if (data.instructorEmail) {
            onUpdateInstructorEmail(data.instructorEmail);
          }
          
          setSuccess("Configuration imported successfully.");
          setError(null);
        } else {
          throw new Error("Invalid file format: Missing portraits data.");
        }
      } catch (err) {
        console.error("Failed to parse .persona file", err);
        setError("Invalid .persona file. Please ensure it was exported from this tool.");
        setSuccess(null);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const downloadExcel = () => {
    // Flatten the data: One row per scenario
    const rows: any[] = [];

    personas.forEach(p => {
      if (p.scenarios.length === 0) {
        rows.push({
          PersonaID: p.id,
          PersonaName: p.name,
          PersonaTitle: p.title,
          PersonaDescription: p.description,
          PersonaVisualDescription: p.visualDescription || "",
          PersonaGoal: p.goal,
          PersonaSystemInstruction: p.systemInstruction,
          PersonaEmbeddedContext: p.embeddedContext || "",
          PersonaAvatar: p.avatar,
          PersonaVoiceName: p.voiceName,
          ScenarioID: "",
          ScenarioTitle: "",
          ScenarioContext: "",
          ScenarioSystemPrompt: "",
          ScenarioEmbeddedContext: ""
        });
      } else {
        p.scenarios.forEach(s => {
          rows.push({
            PersonaID: p.id,
            PersonaName: p.name,
            PersonaTitle: p.title,
            PersonaDescription: p.description,
            PersonaVisualDescription: p.visualDescription || "",
            PersonaGoal: p.goal,
            PersonaSystemInstruction: p.systemInstruction,
            PersonaEmbeddedContext: p.embeddedContext || "",
            PersonaAvatar: p.avatar,
            PersonaVoiceName: p.voiceName,
            ScenarioID: s.id,
            ScenarioTitle: s.title,
            ScenarioContext: s.context,
            ScenarioSystemPrompt: s.systemPrompt,
            ScenarioEmbeddedContext: s.embeddedContext || ""
          });
        });
      }
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Personas");
    XLSX.writeFile(workbook, "academic_simulator_data.xlsx");
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        const newPersonas = parseExcel(jsonData);
        onUpdatePersonas(newPersonas);
        setSuccess(`Successfully loaded ${newPersonas.length} personas.`);
        setError(null);
      } catch (err) {
        setError('Failed to parse Excel file. Please ensure the format is correct.');
        setSuccess(null);
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const parseExcel = (data: any[]): Persona[] => {
    const personaMap = new Map<string, Persona>();

    data.forEach((row: any) => {
      const pId = row['PersonaID'] as PersonaType;
      
      if (!pId) return; // Skip empty rows

      if (!personaMap.has(pId)) {
        let voiceName = row['PersonaVoiceName'];
        const validVoices = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];
        if (!validVoices.includes(voiceName)) {
          voiceName = 'Kore'; // Default fallback
        }

        personaMap.set(pId, {
          id: pId,
          name: row['PersonaName'],
          title: row['PersonaTitle'],
          description: row['PersonaDescription'],
          visualDescription: row['PersonaVisualDescription'],
          goal: row['PersonaGoal'],
          systemInstruction: row['PersonaSystemInstruction'],
          embeddedContext: row['PersonaEmbeddedContext'],
          avatar: row['PersonaAvatar'],
          voiceName: voiceName as any,
          scenarios: []
        });
      }

      if (row['ScenarioID']) {
        const scenario: Scenario = {
          id: row['ScenarioID'],
          title: row['ScenarioTitle'],
          context: row['ScenarioContext'],
          systemPrompt: row['ScenarioSystemPrompt'],
          embeddedContext: row['ScenarioEmbeddedContext'],
          hints: [] // Hints are not currently in Excel, keeping it empty
        };
        personaMap.get(pId)?.scenarios.push(scenario);
      }
    });

    return Array.from(personaMap.values());
  };

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-0 md:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="teacher-mode-modal-title"
    >
      <div className="bg-white rounded-none md:rounded-2xl shadow-2xl w-full h-full md:h-auto md:max-w-2xl overflow-hidden flex flex-col md:max-h-[90%]">
        <div className="bg-[#00274C] p-4 md:p-6 flex justify-between items-center shrink-0">
          <h2 id="teacher-mode-modal-title" className="text-lg md:text-xl font-black text-white uppercase tracking-widest">Faculty</h2>
          <button 
            onClick={onClose} 
            className="text-white/60 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#FFCB05] rounded"
            aria-label="Close Teacher Mode"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        
        <div className="p-6 md:p-8 space-y-6 md:space-y-8 overflow-y-auto">
          <div className="space-y-3 md:space-y-4">
            <h3 className="text-[#00274C] font-bold text-base md:text-lg border-b border-gray-200 pb-2">1. Download Current Data</h3>
            <p className="text-xs md:text-sm text-slate-600">Download the current set of Personas and Scenarios as an Excel spreadsheet. You can edit this file to add or modify content.</p>
            <button 
              onClick={downloadExcel}
              className="flex items-center gap-2 bg-[#FFCB05] text-[#00274C] px-5 md:px-6 py-2.5 md:py-3 rounded-lg md:rounded-xl font-bold uppercase text-[10px] md:text-xs tracking-wider hover:bg-[#ffe066] transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-[#00274C]"
              aria-label="Download current data as Excel"
            >
              <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              Download Excel
            </button>
          </div>

          <div className="space-y-3 md:space-y-4">
            <h3 className="text-[#00274C] font-bold text-base md:text-lg border-b border-gray-200 pb-2">2. Upload Updated Data</h3>
            <p className="text-xs md:text-sm text-slate-600">Upload your edited Excel file (.xlsx) to update the simulator for this session. <span className="font-bold text-red-500">Warning: This will replace all current personas.</span></p>
            
            <div className="flex flex-col gap-3 md:gap-4">
              <input 
                type="file" 
                accept=".xlsx, .xls"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="block w-full text-[10px] md:text-sm text-slate-500
                  file:mr-3 md:file:mr-4 file:py-1.5 md:file:py-2 file:px-3 md:file:px-4
                  file:rounded-full file:border-0
                  file:text-[10px] md:file:text-xs file:font-semibold
                  file:bg-[#00274C]/10 file:text-[#00274C]
                  hover:file:bg-[#00274C]/20
                  focus:outline-none focus:ring-2 focus:ring-[#00274C]
                "
                aria-label="Upload updated Excel data"
              />
              
              {error && (
                <div className="bg-red-50 text-red-600 p-3 md:p-4 rounded-xl text-xs md:text-sm flex items-start gap-2" role="alert">
                  <svg className="w-4 h-4 md:w-5 md:h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  {error}
                </div>
              )}
              
              {success && (
                <div className="bg-green-50 text-green-700 p-3 md:p-4 rounded-xl text-xs md:text-sm flex items-start gap-2" role="alert">
                  <svg className="w-4 h-4 md:w-5 md:h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
                  {success}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 md:space-y-4">
            <h3 className="text-[#00274C] font-bold text-base md:text-lg border-b border-gray-200 pb-2">3. Instructor Portraits</h3>
            <p className="text-xs md:text-sm text-slate-600">Manage generated portraits for each person. These are saved locally in your browser.</p>
            
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label 
                  className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-xl font-bold text-[10px] md:text-xs transition-colors cursor-pointer flex items-center justify-center gap-2 focus-within:ring-2 focus-within:ring-[#00274C]"
                  aria-label="Import portraits from .persona file"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                  Import .persona
                  <input type="file" accept=".persona" onChange={handleImportPersonaFile} className="hidden" aria-hidden="true" />
                </label>
                <button 
                  onClick={handleExportPersonaFile}
                  disabled={Object.keys(portraits).length === 0}
                  className="bg-[#00274C] hover:bg-[#00274C]/80 text-white px-3 py-2 rounded-xl font-bold text-[10px] md:text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#FFCB05]"
                  aria-label="Export portraits to .persona file"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  Export .persona
                </button>
                <button 
                  onClick={handleDownloadAll}
                  disabled={Object.keys(portraits).length === 0}
                  className="bg-[#FFCB05] hover:bg-[#FFCB05]/80 text-[#00274C] px-3 py-2 rounded-xl font-bold text-[10px] md:text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#00274C]"
                  aria-label="Download all portraits as PNG files"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  Download PNGs
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto p-2 border border-slate-100 rounded-xl bg-slate-50 custom-scrollbar">
                {personas.map(persona => (
                  <div key={persona.id} className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm flex flex-col items-center text-center">
                    <div className="w-16 h-16 md:w-20 md:h-20 rounded-full overflow-hidden mb-2 bg-slate-100 flex items-center justify-center border-2 border-[#00274C]/10 shrink-0">
                      {portraits[persona.id] ? (
                        <img src={portraits[persona.id]} alt={persona.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl md:text-3xl">{persona.avatar}</span>
                      )}
                    </div>
                    <h4 className="font-bold text-[#00274C] mb-0.5 text-[10px] md:text-xs truncate w-full">{persona.name}</h4>
                    <p className="text-[8px] md:text-[10px] text-slate-500 mb-2 line-clamp-1">{persona.title}</p>
                    
                    <div className="flex flex-col gap-1.5 w-full mt-auto">
                      <div className="flex gap-1">
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="hidden" 
                          ref={el => portraitFileInputRefs.current[persona.id] = el}
                          onChange={(e) => handleFileChange(persona.id, e)}
                        />
                        <button 
                          onClick={() => handleUploadClick(persona.id)}
                          className="flex-1 bg-[#FFCB05] hover:bg-[#FFCB05]/90 text-[#00274C] py-2 rounded-lg text-[9px] md:text-[10px] font-bold transition-colors flex items-center justify-center gap-1"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                          Upload
                        </button>
                        <button 
                          onClick={() => handleDownload(persona.id, persona.name)}
                          disabled={!portraits[persona.id]}
                          className="flex-1 bg-[#00274C] hover:bg-[#00274C]/90 text-white py-2 rounded-lg text-[9px] md:text-[10px] font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3 md:space-y-4">
            <h3 className="text-[#00274C] font-bold text-base md:text-lg border-b border-gray-200 pb-2">4. Instructor Settings</h3>
            <p className="text-xs md:text-sm text-slate-600">Set the email address where student requests for new people and scenarios will be sent.</p>
            <div className="flex gap-2">
              <input 
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="instructor@example.edu"
                className="flex-grow px-4 py-2 rounded-xl border-2 border-[#00274C]/10 focus:border-[#FFCB05] outline-none transition-all text-sm"
                aria-label="Instructor email address"
              />
              <button 
                onClick={handleEmailSave}
                className="bg-[#00274C] text-white px-4 py-2 rounded-xl font-bold uppercase text-[10px] tracking-wider hover:bg-[#003d77] transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-[#FFCB05]"
                aria-label="Save instructor email"
              >
                Save
              </button>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 p-4 md:p-6 border-t border-gray-200 text-center shrink-0">
          <button 
            onClick={onClose}
            className="text-[#00274C] font-bold text-xs md:text-sm hover:underline focus:outline-none focus:ring-2 focus:ring-[#00274C] rounded px-2"
            aria-label="Close Teacher Mode window"
          >
            Close Window
          </button>
        </div>
      </div>
    </div>
  );
};
