import { X } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import jsQR from "jsqr";
import { toast } from "sonner";

interface QRCodeScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

export function QRCodeScanner({ onScan, onClose }: QRCodeScannerProps) {
  const [hasCamera, setHasCamera] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let mounted = true;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });

        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }

        setHasCamera(true);
      } catch (err) {
        console.error("Camera access error:", err);
        setHasCamera(false);
        toast.error("Unable to access camera. Please grant camera permissions.");
      }
    };

    startCamera();

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const scanQRCode = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });

        if (code && code.data) {
          // Extract room ID from URL if it's a full URL
          let roomId = code.data;
          try {
            const url = new URL(code.data);
            const pathMatch = url.pathname.match(/\/room\/([^\/]+)/);
            if (pathMatch) {
              roomId = pathMatch[1];
            }
          } catch {
            // Not a URL, use as-is
          }
          
          onScan(roomId);
          return;
        }
      }

      animationFrameRef.current = requestAnimationFrame(scanQRCode);
    };

    const handleLoadedMetadata = () => {
      scanQRCode();
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);

    if (video.readyState >= video.HAVE_ENOUGH_DATA) {
      scanQRCode();
    }

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <div className="relative w-full max-w-md p-4">
        <button 
          onClick={onClose}
          className="absolute top-2 right-2 z-10 p-2 text-white/50 hover:text-white transition-colors bg-black/50 rounded-full"
          data-testid="button-close-scanner"
        >
          <X className="h-6 w-6" />
        </button>
        
        <div className="relative aspect-square overflow-hidden rounded-xl border-2 border-white/10 bg-black">
          {hasCamera ? (
            <>
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
                playsInline
                muted
              />
              <canvas ref={canvasRef} className="hidden" />
              
              {/* Scanning Overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
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
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center p-6">
                <p className="text-white font-mono text-sm mb-2">Camera Access Denied</p>
                <p className="text-white/60 text-xs">
                  Please enable camera permissions in your browser settings
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
