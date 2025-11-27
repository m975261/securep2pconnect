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

              <div className="space-y-2">
                <p className="text-sm font-medium">Download Helper:</p>
                <div className="grid gap-2">
                  <Button variant="outline" size="sm" className="justify-start" asChild>
                    <a href="/helper/builds/securelink-helper-windows-amd64.exe" download>
                      <Download className="mr-2 h-4 w-4" />
                      Windows (64-bit)
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" className="justify-start" asChild>
                    <a href="/helper/builds/securelink-helper-macos-arm64" download>
                      <Download className="mr-2 h-4 w-4" />
                      macOS (Apple Silicon)
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" className="justify-start" asChild>
                    <a href="/helper/builds/securelink-helper-macos-amd64" download>
                      <Download className="mr-2 h-4 w-4" />
                      macOS (Intel)
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" className="justify-start" asChild>
                    <a href="/helper/builds/securelink-helper-linux-amd64" download>
                      <Download className="mr-2 h-4 w-4" />
                      Linux (64-bit)
                    </a>
                  </Button>
                </div>

                <div className="mt-4 p-3 bg-muted rounded-md">
                  <p className="text-xs text-muted-foreground">
                    <strong>After downloading:</strong><br />
                    1. Run the helper application<br />
                    2. A console will open showing your Peer ID<br />
                    3. Click "I Have It Running" below
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
