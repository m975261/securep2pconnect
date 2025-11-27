import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface HelperPromptProps {
  open: boolean;
  onHelperConnected: (peerId: string) => void;
  onCancel?: () => void;
}

export function HelperPrompt({ open, onHelperConnected, onCancel }: HelperPromptProps) {
  const [checking, setChecking] = useState(false);
  const [helperStatus, setHelperStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [peerId, setPeerId] = useState<string>('');

  useEffect(() => {
    if (!open) return;

    const checkHelper = async () => {
      setChecking(true);
      setHelperStatus('checking');

      try {
        const ws = new WebSocket('ws://127.0.0.1:52100');

        const timeout = setTimeout(() => {
          ws.close();
          setHelperStatus('disconnected');
          setChecking(false);
        }, 3000);

        ws.onopen = () => {
          console.log('Helper WebSocket opened');
        };

        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.type === 'peer-id') {
            clearTimeout(timeout);
            const peerIdValue = JSON.parse(msg.data);
            setPeerId(peerIdValue);
            setHelperStatus('connected');
            setChecking(false);
            ws.close();
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          setHelperStatus('disconnected');
          setChecking(false);
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          if (helperStatus === 'checking') {
            setHelperStatus('disconnected');
            setChecking(false);
          }
        };
      } catch (error) {
        setHelperStatus('disconnected');
        setChecking(false);
      }
    };

    checkHelper();
  }, [open]);

  const handleContinue = () => {
    if (helperStatus === 'connected' && peerId) {
      onHelperConnected(peerId);
    }
  };

  const handleRetry = () => {
    setChecking(true);
    setHelperStatus('checking');
    window.location.reload(); // Simple retry - recheck on mount
  };

  return (
    <Dialog open={open} onOpenChange={() => onCancel?.()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>P2P Helper Required</DialogTitle>
          <DialogDescription>
            For maximum privacy and security, this app uses a native helper application that hides your IP address.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {helperStatus === 'checking' && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription>
                Checking for helper application...
              </AlertDescription>
            </Alert>
          )}

          {helperStatus === 'connected' && (
            <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800 dark:text-green-200">
                Helper connected! Your Peer ID: {peerId.substring(0, 20)}...
              </AlertDescription>
            </Alert>
          )}

          {helperStatus === 'disconnected' && (
            <>
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>
                  Helper not detected. Please download and run it first.
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <p className="text-sm font-medium">How to Get the Helper:</p>
                <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium">Build it locally with Go 1.21+:</p>
                  <div className="font-mono text-xs bg-black/50 p-2 rounded space-y-1">
                    <div>1. Download the project files</div>
                    <div>2. cd helper/</div>
                    <div>3. go build -o securelink-helper main-refactored.go</div>
                    <div>4. Run: ./securelink-helper</div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The helper shows your Peer ID in the console when running.
                  </p>
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
                    ⚠️ Pre-built binaries are not yet available. You must compile locally.
                  </p>
                </div>

                <div className="p-3 bg-muted rounded-md">
                  <p className="text-xs text-muted-foreground">
                    <strong>After starting the helper:</strong><br />
                    1. Keep the helper console window open<br />
                    2. Click "I Have It Running" below to connect
                  </p>
                </div>
              </div>
            </>
          )}

          <div className="flex gap-2">
            {helperStatus === 'disconnected' && (
              <Button onClick={handleRetry} variant="outline" className="flex-1">
                I Have It Running
              </Button>
            )}
            {helperStatus === 'connected' && (
              <Button onClick={handleContinue} className="flex-1">
                Continue
              </Button>
            )}
            {onCancel && (
              <Button onClick={onCancel} variant="ghost">
                Cancel
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
