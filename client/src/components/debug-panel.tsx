import { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { X, ChevronDown, ChevronUp } from 'lucide-react';

interface LogEntry {
  timestamp: Date;
  type: 'log' | 'warn' | 'error';
  message: string;
}

export function DebugPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Intercept console methods
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args: any[]) => {
      originalLog(...args);
      addLog('log', args.join(' '));
    };

    console.warn = (...args: any[]) => {
      originalWarn(...args);
      addLog('warn', args.join(' '));
    };

    console.error = (...args: any[]) => {
      originalError(...args);
      addLog('error', args.join(' '));
    };

    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, []);

  const addLog = (type: 'log' | 'warn' | 'error', message: string) => {
    setLogs(prev => [...prev.slice(-99), { timestamp: new Date(), type, message }]);
  };

  useEffect(() => {
    if (isOpen && !isMinimized) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isOpen, isMinimized]);

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-50 bg-blue-600 hover:bg-blue-700 text-white rounded-full w-12 h-12 p-0 shadow-lg"
        data-testid="button-debug"
      >
        🐛
      </Button>
    );
  }

  return (
    <div className={`fixed bottom-0 left-0 right-0 z-50 bg-black/95 border-t border-white/20 ${isMinimized ? 'h-12' : 'h-80'} transition-all`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-white font-bold">DEBUG LOGS</span>
          <span className="text-[10px] text-white/50">({logs.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLogs([])}
            className="h-6 px-2 text-[10px] text-white/70 hover:text-white"
          >
            CLEAR
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsMinimized(!isMinimized)}
            className="h-6 w-6 p-0 text-white/70 hover:text-white"
          >
            {isMinimized ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsOpen(false)}
            className="h-6 w-6 p-0 text-white/70 hover:text-white"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {!isMinimized && (
        <div className="overflow-y-auto h-[calc(100%-3rem)] p-2 space-y-1">
          {logs.map((log, i) => (
            <div
              key={i}
              className={`text-[10px] font-mono p-1 rounded ${
                log.type === 'error'
                  ? 'bg-red-500/10 text-red-400'
                  : log.type === 'warn'
                  ? 'bg-yellow-500/10 text-yellow-400'
                  : 'text-white/80'
              }`}
            >
              <span className="text-white/40 mr-2">
                {log.timestamp.toLocaleTimeString()}
              </span>
              {log.message}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  );
}
