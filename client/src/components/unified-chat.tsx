import { motion, AnimatePresence } from "framer-motion";
import { Send, Paperclip, File as FileIcon, Download, Image as ImageIcon, FileVideo, FileAudio, FileArchive } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";

export interface UnifiedMessage {
  id: string;
  type: 'text' | 'file';
  sender: 'me' | 'peer';
  timestamp: Date;
  senderName?: string;
  text?: string;
  file?: {
    name: string;
    size: number;
    url: string;
    mimeType?: string;
  };
}

interface UnifiedChatProps {
  messages: UnifiedMessage[];
  onSendMessage: (text: string) => void;
  onSendFile: (file: File, onProgress?: (progress: number) => void) => Promise<void>;
  peerNickname?: string;
  connectionState?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileIcon(mimeType?: string, fileName?: string) {
  const type = mimeType || '';
  const name = (fileName || '').toLowerCase();
  
  if (type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(name)) {
    return <ImageIcon className="w-5 h-5 text-blue-400" />;
  }
  if (type.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/i.test(name)) {
    return <FileVideo className="w-5 h-5 text-purple-400" />;
  }
  if (type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/i.test(name)) {
    return <FileAudio className="w-5 h-5 text-orange-400" />;
  }
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) {
    return <FileArchive className="w-5 h-5 text-yellow-400" />;
  }
  return <FileIcon className="w-5 h-5 text-accent" />;
}

export function UnifiedChat({ messages, onSendMessage, onSendFile, peerNickname, connectionState }: UnifiedChatProps) {
  const [inputValue, setInputValue] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{ fileName: string; progress: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    onSendMessage(inputValue.trim());
    setInputValue("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const file = files[0];
    setUploadProgress({ fileName: file.name, progress: 0 });
    
    try {
      await onSendFile(file, (progress) => {
        setUploadProgress({ fileName: file.name, progress });
      });
    } catch (error) {
      console.error('Error sending file:', error);
    } finally {
      setUploadProgress(null);
      e.target.value = '';
      inputRef.current?.focus();
    }
  };

  const handleDownload = (file: NonNullable<UnifiedMessage['file']>) => {
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex flex-col h-full bg-black/40 backdrop-blur-sm rounded-xl border border-white/5 overflow-hidden">
      <div className="p-2 border-b border-white/5 bg-black/20 shrink-0">
        <div className="flex justify-between items-center mb-1.5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-mono text-muted-foreground">ENCRYPTED CHANNEL</span>
          </div>
          <div className="text-xs font-mono text-muted-foreground opacity-50">
            P2P-WEBRTC-V2
          </div>
        </div>
        {peerNickname && connectionState === 'connected' && (
          <div className="flex items-center gap-2 px-2 py-1 bg-primary/5 border border-primary/20 rounded-md" data-testid="peer-status">
            <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(0,255,157,0.5)] animate-pulse" />
            <span className="text-[11px] font-mono text-primary/90">
              {peerNickname}
            </span>
            <span className="text-[10px] font-mono text-primary/50">
              • CONNECTED
            </span>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-2 border-b border-white/5 bg-black/40 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type secure message..."
            rows={1}
            className="flex-1 bg-black/50 border border-white/10 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors resize-none min-h-[38px] max-h-[120px]"
            style={{ height: 'auto', overflowY: inputValue.split('\n').length > 3 ? 'auto' : 'hidden' }}
            autoFocus
            data-testid="input-message"
          />
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            className="hidden"
            data-testid="input-file-hidden"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 bg-white/5 border border-white/10 hover:bg-white/10"
            onClick={() => fileInputRef.current?.click()}
            disabled={!!uploadProgress}
            data-testid="button-attach-file"
          >
            <Paperclip className="w-4 h-4" />
          </Button>
          <Button
            type="submit"
            size="icon"
            className="h-9 w-9 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
            disabled={!inputValue.trim()}
            data-testid="button-send"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        
        {uploadProgress && (
          <div className="mt-2 bg-black/30 rounded-md p-2">
            <div className="flex items-center justify-between text-xs font-mono mb-1">
              <span className="truncate text-white/70">{uploadProgress.fileName}</span>
              <span className="text-accent font-bold">{uploadProgress.progress}%</span>
            </div>
            <div className="h-1.5 bg-black/50 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-gradient-to-r from-accent to-green-400"
                initial={{ width: 0 }}
                animate={{ width: `${uploadProgress.progress}%` }}
                transition={{ duration: 0.2 }}
              />
            </div>
          </div>
        )}
      </form>

      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
        <AnimatePresence>
          {[...messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()).map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`flex flex-col ${msg.sender === "me" ? "items-end" : "items-start"}`}
            >
              <span className={`text-[10px] font-mono font-semibold mb-1 px-1 ${
                msg.sender === "me" ? "text-primary" : "text-white/70"
              }`} data-testid={`label-${msg.sender}-nickname`}>
                {msg.senderName || (msg.sender === "me" ? "You" : "Peer")}
              </span>
              
              {msg.type === 'text' ? (
                <div
                  className={`max-w-[80%] p-2 rounded-lg text-sm font-mono ${
                    msg.sender === "me"
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "bg-white/5 text-white/80 border border-white/10"
                  }`}
                  data-testid={`message-text-${msg.id}`}
                >
                  {msg.text}
                  <div className="text-[10px] opacity-30 mt-0.5 text-right">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ) : msg.file && (
                <div
                  className={`max-w-[85%] p-3 rounded-lg cursor-pointer transition-all ${
                    msg.sender === "me"
                      ? "bg-accent/10 border border-accent/30 hover:bg-accent/15"
                      : "bg-blue-500/10 border border-blue-500/30 hover:bg-blue-500/15"
                  }`}
                  onClick={() => handleDownload(msg.file!)}
                  data-testid={`message-file-${msg.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${
                      msg.sender === "me" ? "bg-accent/20" : "bg-blue-500/20"
                    }`}>
                      {getFileIcon(msg.file.mimeType, msg.file.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono truncate text-white/90" title={msg.file.name}>
                        {msg.file.name}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {formatFileSize(msg.file.size)}
                      </div>
                    </div>
                    <div className={`h-8 w-8 shrink-0 flex items-center justify-center ${
                      msg.sender === "me" ? "text-accent" : "text-blue-400"
                    }`}>
                      <Download className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="text-[10px] opacity-30 mt-1 text-right">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
