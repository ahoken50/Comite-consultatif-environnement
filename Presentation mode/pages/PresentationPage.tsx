
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MOCK_MEETING } from '../mockData';
import { AgendaItem, Attachment, Note } from '../types';
import AgendaSidebar from '../components/AgendaSidebar';
import TopicTimer from '../components/TopicTimer';
import DocumentViewer from '../components/DocumentViewer';
import QuickNotesPanel from '../components/QuickNotesPanel';

// Broadcast Channel for Dual Screen (#2)
const broadcastChannel = new BroadcastChannel('cce_presentation_channel');

const PresentationPage: React.FC = () => {
  const [meeting] = useState(MOCK_MEETING);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeAttachment, setActiveAttachment] = useState<Attachment | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isNotesVisible, setIsNotesVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCinemaMode, setIsCinemaMode] = useState(false); // New Cinema Mode State
  
  // Interactive Tools State
  const [isLaserEnabled, setIsLaserEnabled] = useState(false);
  const [isDrawingEnabled, setIsDrawingEnabled] = useState(false);
  
  // Search State (#9)
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Audio Recording State (#3)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<number | null>(null);

  const currentItem = meeting.agenda[currentIndex];

  useEffect(() => {
    broadcastChannel.postMessage({
      type: 'SYNC_STATE',
      payload: { currentIndex, activeAttachment, isLaserEnabled, isDrawingEnabled }
    });
  }, [currentIndex, activeAttachment, isLaserEnabled, isDrawingEnabled]);

  const openProjectorWindow = () => {
    window.open('/#/projection', 'CCE_Projector', 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no');
  };

  useEffect(() => {
    if (currentItem.attachments.length > 0) setActiveAttachment(currentItem.attachments[0]);
    else setActiveAttachment(null);
  }, [currentIndex, currentItem]);

  // Audio Recording Logic
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (event) => audioChunksRef.current.push(event.data);
      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(audioBlob);
        link.download = `Enregistrement_CCE_${new Date().toISOString()}.webm`;
        link.click();
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
      recordingIntervalRef.current = window.setInterval(() => setRecordingSeconds(s => s + 1), 1000);
    } catch (err) {
      alert("Impossible d'accéder au microphone.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      setIsRecording(false);
      setRecordingSeconds(0);
    }
  };

  const formatDuration = (totalSeconds: number) => {
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(console.error);
    else document.exitFullscreen();
  };

  // Auto-collapse sidebar in Cinema Mode
  useEffect(() => {
    if (isCinemaMode) setIsSidebarCollapsed(true);
  }, [isCinemaMode]);

  const handleNext = useCallback(() => {
    if (currentIndex < meeting.agenda.length - 1) setCurrentIndex(prev => prev + 1);
  }, [currentIndex, meeting.agenda.length]);

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex(prev => prev - 1);
  }, [currentIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) && e.key !== 'Escape') return;
      if (e.ctrlKey && e.key === 'k') { e.preventDefault(); setIsSearchOpen(v => !v); }
      else if (e.key === 'Escape') setIsSearchOpen(false);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') handleNext();
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') handlePrev();
      else if (e.key === 'f') toggleFullscreen();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev]);

  const filteredAgenda = meeting.agenda.filter(item => 
    item.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    item.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={`h-screen w-screen flex flex-col overflow-hidden text-slate-900 transition-colors duration-500 ${isFullscreen ? 'bg-black' : 'bg-white'}`}>
      
      {/* MINIMAL HEADER */}
      <header className={`h-20 px-6 flex items-center justify-between shrink-0 z-30 transition-all ${isFullscreen ? 'bg-black text-white' : 'bg-white border-b border-slate-100'}`}>
        <div className="flex items-center gap-4">
          {/* Simple Logo */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={openProjectorWindow}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-xs ${isFullscreen ? 'bg-white text-black' : 'bg-emerald-900 text-white'}`}>
                CCE
            </div>
            <div>
                <h1 className="font-bold text-sm leading-tight">Comité Consultatif<br/>en Environnement</h1>
            </div>
          </div>
          <div className="h-8 w-[1px] bg-slate-200 mx-2"></div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{meeting.date}</p>
        </div>

        {/* Center Controls - Simplified */}
        <div className="flex items-center gap-4">
            {/* Recording - Only Icon */}
            <button 
                onClick={isRecording ? stopRecording : startRecording}
                className={`flex items-center gap-3 px-4 py-2 rounded-full transition-all ${isRecording ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
            >
                <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-rose-500 animate-pulse' : 'bg-slate-400'}`}></div>
                <span className="text-xs font-bold tabular-nums">{formatDuration(recordingSeconds)}</span>
            </button>

            <TopicTimer initialMinutes={currentItem.durationInMinutes} />
            
            <div className="h-6 w-[1px] bg-slate-200 mx-1"></div>

             {/* Minimal Tools */}
            <div className="flex items-center gap-1">
                <button onClick={() => setIsLaserEnabled(!isLaserEnabled)} className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all ${isLaserEnabled ? 'bg-red-100 text-red-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`} title="Pointeur Laser"><i className="fa-solid fa-crosshairs"></i></button>
                <button onClick={() => setIsDrawingEnabled(!isDrawingEnabled)} className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all ${isDrawingEnabled ? 'bg-amber-100 text-amber-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`} title="Dessiner"><i className="fa-solid fa-pencil"></i></button>
                <div className="w-[1px] h-4 bg-slate-200 mx-1"></div>
                <button 
                  onClick={() => setIsCinemaMode(!isCinemaMode)} 
                  className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all ${isCinemaMode ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                  title="Mode Cinéma"
                >
                  <i className="fa-solid fa-film"></i>
                </button>
                <button onClick={() => setIsNotesVisible(!isNotesVisible)} className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all ${isNotesVisible ? 'bg-amber-100 text-amber-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}><i className="fa-solid fa-pen-nib"></i></button>
                <button onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50"><i className={`fa-solid ${isSidebarCollapsed ? 'fa-list' : 'fa-times'}`}></i></button>
                <button onClick={toggleFullscreen} className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50"><i className={`fa-solid ${isFullscreen ? 'fa-compress' : 'fa-expand'}`}></i></button>
            </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Agenda Sidebar - Auto collapsed in Cinema Mode */}
        <aside className={`transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] overflow-hidden ${isSidebarCollapsed || isCinemaMode ? 'w-0 opacity-0' : 'w-80 opacity-100'}`}>
          <AgendaSidebar items={meeting.agenda} currentIndex={currentIndex} onSelect={setCurrentIndex} />
        </aside>

        {/* Content Area */}
        <div className="flex-1 flex flex-col relative">
          <div className="flex-1 flex">
            
            {/* Details Column - Collapses to 0 width in Cinema Mode */}
            <div className={`flex flex-col overflow-y-auto transition-all duration-500 ease-in-out ${isFullscreen ? 'bg-black text-slate-300' : 'bg-white'} ${isCinemaMode ? 'w-0 p-0 opacity-0' : 'w-[35%] p-10 opacity-100'}`}>
                
                {/* Topic Indicator */}
                <div className="mb-6 flex items-center gap-3 min-w-[300px]">
                    <span className="text-4xl font-black text-slate-200 tabular-nums">{(currentIndex + 1).toString().padStart(2, '0')}</span>
                    <div className="h-px bg-slate-100 flex-1"></div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">En Discussion</span>
                </div>

                {/* Title */}
                <h2 className={`text-3xl font-heading font-extrabold leading-tight mb-8 ${isFullscreen ? 'text-white' : 'text-slate-900'} min-w-[300px]`}>
                  {currentItem.title}
                </h2>

                {/* Info (No Boxes) */}
                <div className="space-y-8 min-w-[300px]">
                    <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Présentateur</h4>
                        <div className="flex items-center gap-3">
                             <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-black text-slate-500">
                                {currentItem.presenter.charAt(0)}
                             </div>
                             <p className="font-bold text-lg">{currentItem.presenter}</p>
                        </div>
                    </div>

                    <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Contexte</h4>
                        <p className={`text-lg leading-relaxed font-medium ${isFullscreen ? 'text-slate-400' : 'text-slate-600'}`}>
                            {currentItem.description}
                        </p>
                    </div>

                    {/* Attachments (Minimalist List) */}
                    {currentItem.attachments.length > 0 && (
                        <div>
                             <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Documents</h4>
                             <div className="flex flex-col gap-2">
                                {currentItem.attachments.map(att => (
                                    <button 
                                        key={att.id}
                                        onClick={() => setActiveAttachment(att)}
                                        className={`flex items-center gap-3 p-3 rounded-lg text-sm font-medium transition-all text-left ${activeAttachment?.id === att.id ? 'bg-emerald-50 text-emerald-800' : 'hover:bg-slate-50 text-slate-600'}`}
                                    >
                                        <i className={`fa-solid ${att.type === 'image' ? 'fa-image' : 'fa-file-pdf'} text-slate-400`}></i>
                                        {att.name}
                                    </button>
                                ))}
                             </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Document Column - Expands in Cinema Mode */}
            <div className={`flex-1 relative transition-colors duration-500 ${isFullscreen ? 'bg-black' : 'bg-slate-100'}`}>
              <DocumentViewer 
                activeAttachment={activeAttachment}
                allAttachments={currentItem.attachments}
                onSelectAttachment={setActiveAttachment}
                onClose={() => setActiveAttachment(null)}
                enableLaser={isLaserEnabled}
                enableDrawing={isDrawingEnabled}
              />
            </div>
          </div>

          {/* Floating Navigation (Clean Glass) */}
          <div className={`absolute bottom-10 left-[17.5%] -translate-x-1/2 flex items-center gap-4 transition-all duration-500 ${isCinemaMode ? 'translate-y-32 opacity-0' : 'translate-y-0 opacity-100'}`}>
             <button onClick={handlePrev} disabled={currentIndex === 0} className="w-12 h-12 rounded-full bg-white shadow-xl flex items-center justify-center text-slate-400 hover:text-slate-800 disabled:opacity-50 transition-all hover:scale-110">
                <i className="fa-solid fa-arrow-left"></i>
             </button>
             <button onClick={handleNext} disabled={currentIndex === meeting.agenda.length - 1} className="w-12 h-12 rounded-full bg-emerald-600 shadow-xl shadow-emerald-500/30 flex items-center justify-center text-white hover:bg-emerald-500 disabled:opacity-50 transition-all hover:scale-110">
                <i className="fa-solid fa-arrow-right"></i>
             </button>
          </div>
          
          {/* Cinema Mode Mini Nav (Centers when left panel is gone) */}
          <div className={`absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-4 transition-all duration-500 ${isCinemaMode ? 'translate-y-0 opacity-100' : 'translate-y-32 opacity-0'}`}>
             <div className="bg-black/50 backdrop-blur-md rounded-full p-2 flex items-center gap-4 text-white shadow-2xl">
                 <button onClick={handlePrev} className="w-10 h-10 hover:bg-white/20 rounded-full flex items-center justify-center"><i className="fa-solid fa-arrow-left"></i></button>
                 <span className="text-xs font-black uppercase tracking-widest">{currentIndex + 1} / {meeting.agenda.length}</span>
                 <button onClick={handleNext} className="w-10 h-10 hover:bg-white/20 rounded-full flex items-center justify-center"><i className="fa-solid fa-arrow-right"></i></button>
             </div>
          </div>
        </div>

        {/* Quick Notes Panel */}
        <aside className={`transition-all duration-300 ease-in-out border-l border-slate-200 ${isNotesVisible ? 'w-96' : 'w-0'} overflow-hidden`}>
          <QuickNotesPanel itemId={currentItem.id} itemTitle={currentItem.title} onSave={(note) => setNotes(p => ({...p, [currentItem.id]: note}))} initialNote={notes[currentItem.id]} />
        </aside>
      </main>

      {/* Global Search */}
      {isSearchOpen && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-md z-50 flex items-start justify-center pt-32 animate-fade-in">
           <div className="bg-white w-[600px] rounded-2xl shadow-2xl border border-slate-100 overflow-hidden ring-1 ring-black/5">
              <input 
                autoFocus
                type="text"
                placeholder="Rechercher..."
                className="w-full p-6 text-xl font-bold outline-none border-b border-slate-100"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="max-h-[50vh] overflow-y-auto">
                 {filteredAgenda.map((item, idx) => (
                    <button key={item.id} onClick={() => { setCurrentIndex(meeting.agenda.findIndex(a => a.id === item.id)); setIsSearchOpen(false); }} className="w-full text-left p-4 hover:bg-slate-50 border-b border-slate-50 last:border-0">
                        <span className="font-bold block text-slate-800">{item.title}</span>
                        <span className="text-xs text-slate-500">{item.description}</span>
                    </button>
                 ))}
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default PresentationPage;
