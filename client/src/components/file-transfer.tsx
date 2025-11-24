import { useDropzone } from "react-dropzone";
import { Upload, File as FileIcon, X, Check, Download, ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

interface FileTransferProps {
  onSendFile: (file: File) => Promise<void>;
  transferredFiles: Array<{
    name: string;
    size: number;
    url: string;
    type: 'sent' | 'received';
    timestamp: Date;
    senderName?: string;
  }>;
}

export function FileTransfer({ onSendFile, transferredFiles }: FileTransferProps) {
  const [files, setFiles] = useState<Array<{ name: string; size: string; progress: number; status: 'uploading' | 'completed' }>>([]);

  const onDrop = async (acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map(file => ({
      name: file.name,
      size: (file.size / 1024 / 1024).toFixed(2) + " MB",
      progress: 0,
      status: 'uploading' as const
    }));

    setFiles(prev => [...prev, ...newFiles]);

    for (let i = 0; i < acceptedFiles.length; i++) {
      const file = acceptedFiles[i];
      const fileIndex = files.length + i;

      try {
        let progress = 0;
        const interval = setInterval(() => {
          progress += 10;
          if (progress >= 100) {
            clearInterval(interval);
          }
          setFiles(prev => {
            const updated = [...prev];
            if (updated[fileIndex]) {
              updated[fileIndex].progress = Math.min(progress, 100);
            }
            return updated;
          });
        }, 100);

        await onSendFile(file);
        
        clearInterval(interval);
        setFiles(prev => {
          const updated = [...prev];
          if (updated[fileIndex]) {
            updated[fileIndex].status = 'completed';
            updated[fileIndex].progress = 100;
          }
          return updated;
        });
      } catch (error) {
        console.error('Error sending file:', error);
      }
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer h-32 flex flex-col items-center justify-center
          ${isDragActive 
            ? "border-primary bg-primary/5 text-primary" 
            : "border-white/10 hover:border-white/20 text-muted-foreground"
          }
        `}
        data-testid="dropzone-files"
      >
        <input {...getInputProps()} />
        <Upload className={`w-8 h-8 mb-2 ${isDragActive ? "animate-bounce" : ""}`} />
        <p className="text-xs font-mono">DROP FILES TO ENCRYPT & SEND</p>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        <AnimatePresence>
          {files.map((file, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white/5 border border-white/5 rounded-lg p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 overflow-hidden">
                  <div className="p-1.5 bg-black/50 rounded">
                    <FileIcon className="w-3 h-3 text-accent" />
                  </div>
                  <div className="truncate">
                    <div className="text-xs font-mono truncate text-white/90" data-testid={`text-filename-${idx}`}>{file.name}</div>
                    <div className="text-[10px] text-muted-foreground">{file.size}</div>
                  </div>
                </div>
                {file.status === 'completed' ? (
                  <Check className="w-4 h-4 text-primary" />
                ) : (
                  <span className="text-[10px] font-mono text-accent animate-pulse">SENDING...</span>
                )}
              </div>
              
              <div className="h-1 bg-black/50 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-accent"
                  initial={{ width: 0 }}
                  animate={{ width: `${file.progress}%` }}
                />
              </div>
            </motion.div>
          ))}

          {transferredFiles.length > 0 && (
            <div className="pt-2 border-t border-white/5 mt-2">
              <h3 className="text-[10px] font-mono text-muted-foreground mb-2 uppercase">Transfer History</h3>
              {transferredFiles.slice().reverse().map((file, idx) => (
                <motion.div
                  key={`${file.timestamp.getTime()}-${idx}`}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white/5 border border-white/5 rounded-lg p-3 mb-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
                      <div className="p-1.5 bg-black/50 rounded">
                        {file.type === 'sent' ? (
                          <ArrowUp className="w-3 h-3 text-blue-400" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-green-400" />
                        )}
                      </div>
                      <div className="truncate flex-1 min-w-0">
                        <div className="text-xs font-mono truncate text-white/90" data-testid={`file-${file.type}-${idx}`}>
                          {file.name}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {(file.size / 1024 / 1024).toFixed(2)} MB • {file.type === 'sent' ? `Sent by ${file.senderName || 'You'}` : `Received from ${file.senderName || 'Peer'}`}
                        </div>
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = file.url;
                        a.download = file.name;
                        a.click();
                      }}
                      data-testid={`button-download-${idx}`}
                    >
                      <Download className="w-3 h-3" />
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
