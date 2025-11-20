import { useDropzone } from "react-dropzone";
import { Upload, File as FileIcon, X, Check } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export function FileTransfer() {
  const [files, setFiles] = useState<Array<{ name: string; size: string; progress: number; status: 'uploading' | 'completed' }>>([]);

  const onDrop = (acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map(file => ({
      name: file.name,
      size: (file.size / 1024 / 1024).toFixed(2) + " MB",
      progress: 0,
      status: 'uploading' as const
    }));

    setFiles(prev => [...prev, ...newFiles]);

    // Simulate upload
    newFiles.forEach((_, index) => {
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 10;
        if (progress >= 100) {
          progress = 100;
          clearInterval(interval);
          setFiles(prev => {
            const updated = [...prev];
            const targetIndex = prev.length - newFiles.length + index;
            if (updated[targetIndex]) {
              updated[targetIndex].status = 'completed';
              updated[targetIndex].progress = 100;
            }
            return updated;
          });
        } else {
          setFiles(prev => {
            const updated = [...prev];
            const targetIndex = prev.length - newFiles.length + index;
            if (updated[targetIndex]) {
              updated[targetIndex].progress = progress;
            }
            return updated;
          });
        }
      }, 200);
    });
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
                    <div className="text-xs font-mono truncate text-white/90">{file.name}</div>
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
        </AnimatePresence>
      </div>
    </div>
  );
}
