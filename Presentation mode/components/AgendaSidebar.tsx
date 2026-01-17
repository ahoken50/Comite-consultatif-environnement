
import React from 'react';
import { AgendaItem } from '../types';

interface AgendaSidebarProps {
  items: AgendaItem[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

const AgendaSidebar: React.FC<AgendaSidebarProps> = ({ items, currentIndex, onSelect }) => {
  return (
    <div className="h-full bg-slate-50 flex flex-col overflow-hidden">
      <div className="p-8 border-b border-emerald-900/10 bg-emerald-950 text-white relative overflow-hidden">
        {/* Abstract background element */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl -mr-16 -mt-16"></div>
        
        <h2 className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-400 mb-3">Séquence de l'ordre du jour</h2>
        <div className="flex items-center gap-4">
          <div className="h-2.5 flex-1 bg-white/10 rounded-full overflow-hidden p-0.5">
            <div 
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-300 rounded-full transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(16,185,129,0.3)]"
              style={{ width: `${((currentIndex + 1) / items.length) * 100}%` }}
            />
          </div>
          <span className="text-sm font-black tabular-nums">{currentIndex + 1} <span className="text-white/30">/</span> {items.length}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
        {items.map((item, index) => {
          const isActive = index === currentIndex;
          const isDone = index < currentIndex;
          
          return (
            <button
              key={item.id}
              onClick={() => onSelect(index)}
              className={`w-full text-left p-5 rounded-3xl transition-all duration-300 group relative border-2 ${
                isActive 
                  ? 'bg-white border-emerald-500 shadow-[0_15px_30px_-10px_rgba(16,185,129,0.15)] transform scale-[1.02] z-10' 
                  : isDone 
                    ? 'bg-emerald-50/30 border-transparent opacity-80' 
                    : 'bg-white border-transparent hover:bg-white hover:border-slate-200 hover:shadow-lg'
              }`}
            >
              <div className="flex items-start gap-4">
                <div className={`mt-1 flex-shrink-0 w-8 h-8 rounded-2xl flex items-center justify-center text-xs font-black transition-colors ${
                  isActive ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20' : isDone ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
                }`}>
                  {isDone ? <i className="fa-solid fa-check text-sm"></i> : index + 1}
                </div>
                <div className="flex-1 overflow-hidden">
                  <h3 className={`font-black text-sm leading-snug line-clamp-2 transition-colors ${isActive ? 'text-emerald-900' : isDone ? 'text-emerald-800' : 'text-slate-700'}`}>
                    {item.title}
                  </h3>
                  <div className="flex items-center gap-3 mt-3">
                    <span className={`text-[10px] font-bold flex items-center gap-1.5 px-2 py-0.5 rounded-full ${isActive ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400'}`}>
                      <i className="fa-regular fa-clock"></i> {item.durationInMinutes} min
                    </span>
                    {item.attachments.length > 0 && (
                      <span className={`text-[10px] font-bold flex items-center gap-1.5 px-2 py-0.5 rounded-full ${isActive ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400'}`}>
                        <i className="fa-solid fa-paperclip"></i> {item.attachments.length}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="p-6 border-t border-slate-200 bg-white/50">
        <div className="bg-slate-900 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Status de l'assemblée</span>
            <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Synchronisé
            </span>
          </div>
          <div className="flex items-center gap-1.5">
             <kbd className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 shadow-sm text-slate-400 text-[10px] font-black">↑</kbd>
             <kbd className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 shadow-sm text-slate-400 text-[10px] font-black">↓</kbd>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgendaSidebar;
