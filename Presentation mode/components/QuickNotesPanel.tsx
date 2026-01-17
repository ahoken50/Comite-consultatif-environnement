
import React, { useState, useEffect } from 'react';

interface QuickNotesPanelProps {
  itemId: string;
  itemTitle: string;
  onSave: (note: string) => void;
  initialNote?: string;
}

const QuickNotesPanel: React.FC<QuickNotesPanelProps> = ({ itemId, itemTitle, onSave, initialNote = '' }) => {
  const [note, setNote] = useState(initialNote);
  const [isSaved, setIsSaved] = useState(true);

  useEffect(() => {
    setNote(initialNote);
    setIsSaved(true);
  }, [itemId, initialNote]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNote(e.target.value);
    setIsSaved(false);
  };

  const handleSave = () => {
    onSave(note);
    setIsSaved(true);
  };

  return (
    <div className="bg-amber-50 h-full flex flex-col shadow-inner border-l border-amber-200">
      <div className="p-4 bg-amber-100/50 border-b border-amber-200 flex items-center justify-between">
        <div className="flex items-center gap-2 overflow-hidden">
          <i className="fa-solid fa-pen-fancy text-amber-700"></i>
          <h3 className="font-bold text-amber-900 text-sm truncate">Notes : {itemTitle}</h3>
        </div>
        {!isSaved && (
          <span className="text-[10px] font-bold text-amber-600 animate-pulse">En cours...</span>
        )}
      </div>
      
      <div className="flex-1 p-4 relative">
        <textarea
          value={note}
          onChange={handleChange}
          placeholder="Commencez à saisir vos notes ici..."
          className="w-full h-full bg-transparent resize-none focus:outline-none text-amber-950 font-medium placeholder-amber-400/60 leading-relaxed text-sm"
        />
        
        <div className="absolute bottom-4 right-4 flex gap-2">
          <button 
            onClick={handleSave}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
              isSaved 
                ? 'bg-amber-200/50 text-amber-700 cursor-default' 
                : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95'
            }`}
          >
            {isSaved ? <><i className="fa-solid fa-check mr-1"></i> Enregistré</> : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuickNotesPanel;
