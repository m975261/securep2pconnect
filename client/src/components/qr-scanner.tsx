import { motion } from "framer-motion";
import { Scan, X } from "lucide-react";
import { useState, useEffect } from "react";

interface QRCodeScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

export function QRCodeScanner({ onScan, onClose }: QRCodeScannerProps) {
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (scanning) {
        onScan("secure-room-8x92-connected");
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [scanning, onScan]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <div className="relative w-full max-w-md p-4">
        <button 
          onClick={onClose}
          className="absolute top-2 right-2 z-10 p-2 text-white/50 hover:text-white transition-colors"
        >
          <X className="h-6 w-6" />
        </button>
        
        <div className="relative aspect-square overflow-hidden rounded-xl border-2 border-white/10 bg-black">
          {/* Camera Feed Mock */}
          <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1516245834210-c4c14278732d?q=80&w=2069&auto=format&fit=crop')] bg-cover bg-center opacity-30" />
          
          {/* Scanning Overlay */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative h-64 w-64 border-2 border-primary/50 rounded-lg">
              <div className="absolute inset-0 border-2 border-primary opacity-50 animate-pulse" />
              <div className="absolute top-0 left-0 right-0 h-1 bg-primary shadow-[0_0_20px_rgba(0,255,157,0.8)] animate-scan" />
            </div>
          </div>

          <div className="absolute bottom-8 left-0 right-0 text-center">
            <p className="text-sm font-mono text-primary/80 animate-pulse">
              SEARCHING FOR SECURE QR...
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
