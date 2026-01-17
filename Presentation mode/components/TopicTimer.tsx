
import React, { useState, useEffect } from 'react';

interface TopicTimerProps {
  initialMinutes: number;
  onTimeEnd?: () => void;
}

const TopicTimer: React.FC<TopicTimerProps> = ({ initialMinutes, onTimeEnd }) => {
  const [secondsRemaining, setSecondsRemaining] = useState(initialMinutes * 60);
  const [isActive, setIsActive] = useState(false);
  const totalSeconds = initialMinutes * 60;

  useEffect(() => {
    setSecondsRemaining(initialMinutes * 60);
    setIsActive(false);
  }, [initialMinutes]);

  useEffect(() => {
    let interval: any = null;
    if (isActive && secondsRemaining > 0) {
      interval = setInterval(() => {
        setSecondsRemaining((prev) => prev - 1);
      }, 1000);
    } else if (secondsRemaining === 0) {
      setIsActive(false);
      onTimeEnd?.();
    }
    return () => clearInterval(interval);
  }, [isActive, secondsRemaining, onTimeEnd]);

  const toggle = () => setIsActive(!isActive);
  const reset = () => {
    setSecondsRemaining(initialMinutes * 60);
    setIsActive(false);
  };

  const formatTime = (totalSecs: number) => {
    const mins = Math.floor(Math.abs(totalSecs) / 60);
    const secs = Math.abs(totalSecs) % 60;
    const sign = totalSecs < 0 ? '-' : '';
    return `${sign}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Smart Indicators Logic (#8)
  const percentageLeft = (secondsRemaining / totalSeconds) * 100;
  
  let colorClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  let iconColor = 'text-emerald-600';
  let statusText = 'TEMPS RESTANT';

  if (secondsRemaining <= 0) {
    colorClass = 'bg-rose-100 text-rose-700 border-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.3)] animate-pulse';
    iconColor = 'text-rose-600';
    statusText = 'DÉPASSEMENT';
  } else if (percentageLeft <= 20) {
    // Last 20%
    colorClass = 'bg-amber-50 text-amber-700 border-amber-300';
    iconColor = 'text-amber-600';
    statusText = 'BIEÔT ÉCOULÉ';
  }

  return (
    <div className={`flex items-center gap-4 px-6 py-3 rounded-2xl border-2 transition-all duration-500 ${colorClass}`}>
      <div className="flex flex-col">
        <span className={`text-[9px] uppercase font-black tracking-widest opacity-70 mb-0.5 ${secondsRemaining <= 0 ? 'text-rose-800' : ''}`}>
           {isActive && secondsRemaining > 0 ? <i className="fa-solid fa-hourglass-half mr-1 animate-spin-slow"></i> : null}
           {statusText}
        </span>
        <span className="text-4xl font-heading font-extrabold tracking-tighter tabular-nums leading-none">
          {formatTime(secondsRemaining)}
        </span>
      </div>
      
      <div className="flex flex-col gap-1 ml-4 border-l pl-4 border-black/10">
        <button 
          onClick={toggle}
          className={`p-1.5 hover:bg-black/5 rounded-lg transition-all active:scale-95 ${iconColor}`}
          title={isActive ? "Pause" : "Démarrer"}
        >
          <i className={`fa-solid ${isActive ? 'fa-pause' : 'fa-play'} text-lg`}></i>
        </button>
        <button 
          onClick={reset}
          className="p-1.5 hover:bg-black/5 rounded-lg transition-all active:scale-95 opacity-60 hover:opacity-100"
          title="Réinitialiser"
        >
          <i className="fa-solid fa-rotate-right text-lg"></i>
        </button>
      </div>
      
      {/* Progress Bar Background for visual feedback */}
      <div className="absolute bottom-0 left-0 h-1 bg-current opacity-20 transition-all duration-1000 ease-linear" style={{ width: `${Math.max(0, percentageLeft)}%` }}></div>
    </div>
  );
};

export default TopicTimer;
