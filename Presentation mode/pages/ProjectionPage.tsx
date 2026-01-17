
import React, { useState, useEffect } from 'react';
import { MOCK_MEETING } from '../mockData';
import { Attachment } from '../types';
import DocumentViewer from '../components/DocumentViewer';

const broadcastChannel = new BroadcastChannel('cce_presentation_channel');

const ProjectionPage: React.FC = () => {
  const [meeting] = useState(MOCK_MEETING);
  const [state, setState] = useState({
    currentIndex: 0,
    activeAttachment: null as Attachment | null,
    isLaserEnabled: false,
    isDrawingEnabled: false
  });

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'SYNC_STATE') {
        setState(event.data.payload);
      }
    };

    broadcastChannel.onmessage = handleMessage;
    return () => {
      broadcastChannel.onmessage = null;
    };
  }, []);

  const currentItem = meeting.agenda[state.currentIndex];

  return (
    <div className="w-screen h-screen bg-black overflow-hidden flex flex-col relative">
       
       {state.activeAttachment ? (
         <>
            {/* Minimalist Top Bar for Context */}
            <div className="absolute top-0 left-0 right-0 p-10 flex justify-between items-start pointer-events-none z-50">
                <div className="flex items-center gap-6 animate-fade-in-down">
                    <div className="bg-emerald-600 text-white w-14 h-14 flex items-center justify-center rounded-2xl shadow-2xl">
                        <span className="font-black text-2xl">{state.currentIndex + 1}</span>
                    </div>
                    <div className="bg-black/80 backdrop-blur-xl text-white px-8 py-3 rounded-2xl border border-white/10 shadow-2xl max-w-2xl">
                        <h1 className="text-2xl font-heading font-black leading-tight">{currentItem.title}</h1>
                    </div>
                </div>
            </div>

            {/* Document Content */}
            <div className="flex-1 relative">
                <DocumentViewer 
                    activeAttachment={state.activeAttachment}
                    allAttachments={currentItem.attachments}
                    onSelectAttachment={() => {}} 
                    enableLaser={state.isLaserEnabled}
                    enableDrawing={state.isDrawingEnabled}
                    isProjection={true} // Hides all UI controls
                />
            </div>
         </>
       ) : (
         /* Standby Screen (When no doc is selected) */
         <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
             {/* Background Effects */}
             <div className="absolute inset-0 bg-gradient-to-br from-emerald-950 to-black"></div>
             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-emerald-500/5 rounded-full blur-[100px] animate-pulse"></div>

             <div className="relative z-10 text-center flex flex-col items-center animate-fade-in-up">
                 <div className="w-32 h-32 rounded-full border-4 border-emerald-500/30 flex items-center justify-center mb-8 bg-emerald-900/20 backdrop-blur-md shadow-[0_0_50px_rgba(16,185,129,0.2)]">
                     <i className="fa-solid fa-tree text-6xl text-emerald-500"></i>
                 </div>
                 <h2 className="text-emerald-500 font-black tracking-[0.4em] uppercase text-sm mb-4">Séance Publique</h2>
                 <h1 className="text-white text-6xl font-heading font-black max-w-4xl leading-tight mb-8">
                    {meeting.title}
                 </h1>
                 <div className="h-1 w-24 bg-emerald-600 rounded-full"></div>
                 <p className="mt-8 text-slate-400 font-medium tracking-widest text-sm uppercase">
                    Point en cours : {currentItem.title}
                 </p>
             </div>
         </div>
       )}

       {/* Watermark Bottom Right */}
       <div className="absolute bottom-10 right-10 opacity-40 pointer-events-none z-50">
          <div className="flex flex-col items-end">
             <div className="flex items-center gap-3 mb-1">
                 <div className="h-px w-12 bg-white/50"></div>
                 <span className="text-white font-black uppercase tracking-[0.3em] text-xs">CCE Val-d'Or</span>
             </div>
             <span className="text-emerald-500 font-bold text-[10px] tracking-widest">EN DIRECT</span>
          </div>
       </div>
    </div>
  );
};

export default ProjectionPage;
