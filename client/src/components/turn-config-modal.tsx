import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Server, Lock, User, AlertCircle, Plus, Check, X, Loader2, Wifi, WifiOff, Radio } from "lucide-react";
import { toast } from "sonner";
import { testTurnConnectivity } from "@/lib/webrtc";

export interface TurnConfig {
  urls: string[];
  username: string;
  credential: string;
  stunUrls?: string[];
}

interface TurnConfigModalProps {
  open: boolean;
  onConfigured: (config: TurnConfig) => void;
  onCancel: () => void;
  language?: 'en' | 'ar';
}

const translations = {
  en: {
    title: "Configure TURN Server",
    description: "Enter your TURN server details. All connections will be routed through this relay to prevent IP leakage.",
    serverUrl: "TURN Server URL",
    serverUrlPlaceholder: "turn:server.com:3478?transport=udp",
    stunUrl: "STUN Server URL (Optional)",
    stunUrlPlaceholder: "stun:stun.l.google.com:19302",
    username: "Username",
    usernamePlaceholder: "turn-username",
    credential: "Credential",
    credentialPlaceholder: "turn-password",
    addUrl: "Add Another URL",
    addThis: "Add",
    removeUrl: "Remove",
    connect: "Connect Securely",
    cancel: "Cancel",
    invalidUrl: "Invalid TURN URL format",
    invalidStunUrl: "Invalid STUN URL format",
    requiredFields: "TURN server URL, username, and credential are required",
    example: "Example: turn:relay.com:3478?transport=udp or turns:relay.com:443?transport=tcp",
    stunExample: "Example: stun:stun.l.google.com:19302",
    testConnection: "Test TURN",
    testStun: "Test STUN",
    testing: "Testing...",
    testSuccess: "Connection successful! Found relay candidates.",
    testFailed: "Connection failed",
    stunTestSuccess: "STUN server is reachable!",
    stunTestFailed: "STUN test failed",
  },
  ar: {
    title: "تكوين خادم TURN",
    description: "أدخل تفاصيل خادم TURN الخاص بك. سيتم توجيه جميع الاتصالات عبر هذا المُرحّل لمنع تسرب عنوان IP.",
    serverUrl: "عنوان URL لخادم TURN",
    serverUrlPlaceholder: "turn:server.com:3478?transport=udp",
    stunUrl: "عنوان URL لخادم STUN (اختياري)",
    stunUrlPlaceholder: "stun:stun.l.google.com:19302",
    username: "اسم المستخدم",
    usernamePlaceholder: "turn-username",
    credential: "كلمة المرور",
    credentialPlaceholder: "turn-password",
    addUrl: "إضافة عنوان URL آخر",
    addThis: "إضافة",
    removeUrl: "إزالة",
    connect: "اتصال آمن",
    cancel: "إلغاء",
    invalidUrl: "تنسيق URL غير صالح لـ TURN",
    invalidStunUrl: "تنسيق URL غير صالح لـ STUN",
    requiredFields: "عنوان URL لخادم TURN واسم المستخدم وكلمة المرور مطلوبة",
    example: "مثال: turn:relay.com:3478?transport=udp أو turns:relay.com:443?transport=tcp",
    stunExample: "مثال: stun:stun.l.google.com:19302",
    testConnection: "اختبار TURN",
    testStun: "اختبار STUN",
    testing: "جاري الاختبار...",
    testSuccess: "نجح الاتصال! تم العثور على مرشحات التتابع.",
    testFailed: "فشل الاتصال",
    stunTestSuccess: "خادم STUN قابل للوصول!",
    stunTestFailed: "فشل اختبار STUN",
  }
};

export function TurnConfigModal({ open, onConfigured, onCancel, language = 'en' }: TurnConfigModalProps) {
  const [urls, setUrls] = useState<string[]>([""]);
  const [confirmedUrls, setConfirmedUrls] = useState<boolean[]>([false]);
  const [stunUrls, setStunUrls] = useState<string[]>([""]);
  const [confirmedStunUrls, setConfirmedStunUrls] = useState<boolean[]>([false]);
  const [username, setUsername] = useState("");
  const [credential, setCredential] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'failed' | null>(null);
  const [isTestingStun, setIsTestingStun] = useState(false);
  const [stunTestResult, setStunTestResult] = useState<'success' | 'failed' | null>(null);

  const t = translations[language];

  // Load saved configuration when modal opens, reset to defaults if no saved config
  useEffect(() => {
    if (open) {
      const savedConfig = localStorage.getItem('turn-config');
      if (savedConfig) {
        try {
          const config = JSON.parse(savedConfig) as TurnConfig;
          // Always set TURN URLs (required)
          if (config.urls && config.urls.length > 0) {
            setUrls(config.urls);
            setConfirmedUrls(config.urls.map(() => true));
          } else {
            setUrls([""]);
            setConfirmedUrls([false]);
          }
          // Always set STUN URLs (optional but preserve them)
          if (config.stunUrls && config.stunUrls.length > 0) {
            setStunUrls(config.stunUrls);
            setConfirmedStunUrls(config.stunUrls.map(() => true));
          } else {
            setStunUrls([""]);
            setConfirmedStunUrls([false]);
          }
          setUsername(config.username || "");
          setCredential(config.credential || "");
        } catch (e) {
          console.error('Failed to parse saved TURN config:', e);
          // Reset to defaults on parse error
          setUrls([""]);
          setConfirmedUrls([false]);
          setStunUrls([""]);
          setConfirmedStunUrls([false]);
          setUsername("");
          setCredential("");
        }
      } else {
        // No saved config - reset to defaults
        setUrls([""]);
        setConfirmedUrls([false]);
        setStunUrls([""]);
        setConfirmedStunUrls([false]);
        setUsername("");
        setCredential("");
      }
      // Reset test states
      setTestResult(null);
      setStunTestResult(null);
    }
  }, [open]);

  const handleTestConnection = async () => {
    const validUrls = urls.filter(url => url.trim());
    
    if (validUrls.length === 0 || !username.trim() || !credential.trim()) {
      toast.error(t.requiredFields);
      return;
    }

    // Validate URL format
    for (const url of validUrls) {
      if (!validateTurnUrl(url)) {
        toast.error(`${t.invalidUrl}: ${url}`);
        return;
      }
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await testTurnConnectivity({
        urls: validUrls,
        username: username.trim(),
        credential: credential.trim(),
      });

      if (result.success) {
        setTestResult('success');
        toast.success(t.testSuccess);
      } else {
        setTestResult('failed');
        toast.error(`${t.testFailed}: ${result.error}`);
      }
    } catch (error: any) {
      setTestResult('failed');
      toast.error(`${t.testFailed}: ${error.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestStunConnection = async () => {
    const validStunUrls = stunUrls.filter(url => url.trim());
    
    if (validStunUrls.length === 0) {
      toast.error("Please enter at least one STUN URL to test");
      return;
    }

    // Validate STUN URL format
    for (const url of validStunUrls) {
      if (!validateStunUrl(url)) {
        toast.error(`${t.invalidStunUrl}: ${url}`);
        return;
      }
    }

    setIsTestingStun(true);
    setStunTestResult(null);

    try {
      // Test STUN connectivity by creating a peer connection with just STUN servers
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: validStunUrls }],
      });
      
      // Create a data channel to trigger ICE gathering
      pc.createDataChannel('stun-test');
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      // Wait for ICE gathering to complete or timeout
      const result = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          pc.close();
          resolve(false);
        }, 10000);

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            // Found a candidate - STUN is working
            clearTimeout(timeout);
            pc.close();
            resolve(true);
          }
        };

        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(timeout);
            pc.close();
            // If we got here without finding candidates, STUN failed
            resolve(false);
          }
        };
      });

      if (result) {
        setStunTestResult('success');
        toast.success(t.stunTestSuccess);
      } else {
        setStunTestResult('failed');
        toast.error(t.stunTestFailed);
      }
    } catch (error: any) {
      setStunTestResult('failed');
      toast.error(`${t.stunTestFailed}: ${error.message}`);
    } finally {
      setIsTestingStun(false);
    }
  };

  const validateTurnUrl = (url: string): boolean => {
    // TURN URLs format: turn:hostname:port or turns:hostname:port, optionally with ?transport=udp|tcp
    return /^turns?:[^:]+:\d+(\?transport=(udp|tcp))?$/.test(url.trim());
  };

  const validateStunUrl = (url: string): boolean => {
    // STUN URLs format: stun:hostname or stun:hostname:port (port is optional, defaults to 3478)
    return /^stun:[^:\s]+(:\d+)?$/.test(url.trim());
  };

  const handleAddUrl = () => {
    setUrls([...urls, ""]);
    setConfirmedUrls([...confirmedUrls, false]);
  };

  const handleRemoveUrl = (index: number) => {
    if (urls.length > 1) {
      setUrls(urls.filter((_, i) => i !== index));
      setConfirmedUrls(confirmedUrls.filter((_, i) => i !== index));
    }
  };

  const handleUrlChange = (index: number, value: string) => {
    const newUrls = [...urls];
    newUrls[index] = value;
    setUrls(newUrls);
    // Reset confirmed status when URL changes
    const newConfirmed = [...confirmedUrls];
    newConfirmed[index] = false;
    setConfirmedUrls(newConfirmed);
  };

  const handleConfirmUrl = (index: number) => {
    const url = urls[index].trim();
    if (!url) {
      toast.error(t.requiredFields);
      return;
    }
    if (!validateTurnUrl(url)) {
      toast.error(`${t.invalidUrl}: ${url}`);
      return;
    }
    const newConfirmed = [...confirmedUrls];
    newConfirmed[index] = true;
    setConfirmedUrls(newConfirmed);
    toast.success(`URL added: ${url}`);
  };

  // STUN URL handlers
  const handleAddStunUrl = () => {
    setStunUrls([...stunUrls, ""]);
    setConfirmedStunUrls([...confirmedStunUrls, false]);
  };

  const handleRemoveStunUrl = (index: number) => {
    if (stunUrls.length > 1) {
      setStunUrls(stunUrls.filter((_, i) => i !== index));
      setConfirmedStunUrls(confirmedStunUrls.filter((_, i) => i !== index));
    } else {
      setStunUrls([""]);
      setConfirmedStunUrls([false]);
    }
  };

  const handleStunUrlChange = (index: number, value: string) => {
    const newUrls = [...stunUrls];
    newUrls[index] = value;
    setStunUrls(newUrls);
    const newConfirmed = [...confirmedStunUrls];
    newConfirmed[index] = false;
    setConfirmedStunUrls(newConfirmed);
  };

  const handleConfirmStunUrl = (index: number) => {
    const url = stunUrls[index].trim();
    if (!url) {
      // Empty STUN is ok, just clear the field
      return;
    }
    if (!validateStunUrl(url)) {
      toast.error(`${t.invalidStunUrl}: ${url}`);
      return;
    }
    const newConfirmed = [...confirmedStunUrls];
    newConfirmed[index] = true;
    setConfirmedStunUrls(newConfirmed);
    toast.success(`STUN URL added: ${url}`);
  };

  const handleSubmit = () => {
    // Validate all fields
    const validUrls = urls.filter(url => url.trim());
    const validStunUrls = stunUrls.filter(url => url.trim());
    
    if (validUrls.length === 0 || !username.trim() || !credential.trim()) {
      toast.error(t.requiredFields);
      return;
    }

    // Validate TURN URL format
    for (const url of validUrls) {
      if (!validateTurnUrl(url)) {
        toast.error(`${t.invalidUrl}: ${url}`);
        return;
      }
    }

    // Validate STUN URL format (optional)
    for (const url of validStunUrls) {
      if (!validateStunUrl(url)) {
        toast.error(`${t.invalidStunUrl}: ${url}`);
        return;
      }
    }

    const config: TurnConfig = {
      urls: validUrls,
      username: username.trim(),
      credential: credential.trim(),
      stunUrls: validStunUrls, // Always include (even if empty for consistency)
    };

    // Store in localStorage for persistence
    localStorage.setItem('turn-config', JSON.stringify(config));
    
    onConfigured(config);
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto bg-zinc-900 border-white/10" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Server className="w-5 h-5 text-primary" />
            {t.title}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Server URLs */}
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Server className="w-4 h-4" />
              {t.serverUrl}
            </Label>
            {urls.map((url, index) => (
              <div key={index} className="flex gap-2 items-center">
                <Input
                  value={url}
                  onChange={(e) => handleUrlChange(index, e.target.value)}
                  placeholder={t.serverUrlPlaceholder}
                  className={`flex-1 bg-black/20 font-mono text-sm ${
                    confirmedUrls[index] 
                      ? 'border-green-500/50 focus:border-green-500' 
                      : 'border-white/10 focus:border-primary/50'
                  }`}
                  data-testid={`input-turn-url-${index}`}
                />
                {!confirmedUrls[index] ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => handleConfirmUrl(index)}
                    className="h-9 w-9 text-green-400 hover:text-green-300 hover:bg-green-500/10 shrink-0"
                    title={t.addThis}
                    data-testid={`button-confirm-url-${index}`}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                ) : (
                  <div className="h-9 w-9 flex items-center justify-center text-green-500 shrink-0">
                    <Check className="w-4 h-4" />
                  </div>
                )}
                {urls.length > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => handleRemoveUrl(index)}
                    className="h-9 w-9 text-red-400 hover:text-red-300 hover:bg-red-500/10 shrink-0"
                    title={t.removeUrl}
                    data-testid={`button-remove-url-${index}`}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddUrl}
                className="flex-1 border-dashed border-white/20 hover:border-primary/50 text-xs"
                data-testid="button-add-url"
              >
                <Plus className="w-3 h-3 mr-1" />
                {t.addUrl}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={isTesting || isTestingStun}
                className={`border-white/10 text-xs ${
                  testResult === 'success' ? 'border-green-500/50 text-green-400' : 
                  testResult === 'failed' ? 'border-red-500/50 text-red-400' : ''
                }`}
                data-testid="button-test-turn-inline"
              >
                {isTesting ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <Wifi className="w-3 h-3 mr-1" />
                )}
                {t.testConnection}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground/50 flex items-start gap-2">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              {t.example}
            </p>
          </div>

          {/* STUN Server URLs (Optional) */}
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Radio className="w-4 h-4" />
              {t.stunUrl}
            </Label>
            {stunUrls.map((url, index) => (
              <div key={index} className="flex gap-2 items-center">
                <Input
                  value={url}
                  onChange={(e) => handleStunUrlChange(index, e.target.value)}
                  placeholder={t.stunUrlPlaceholder}
                  className={`flex-1 bg-black/20 font-mono text-sm ${
                    confirmedStunUrls[index] 
                      ? 'border-green-500/50 focus:border-green-500' 
                      : 'border-white/10 focus:border-primary/50'
                  }`}
                  data-testid={`input-stun-url-${index}`}
                />
                {!confirmedStunUrls[index] && url.trim() ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => handleConfirmStunUrl(index)}
                    className="h-9 w-9 text-green-400 hover:text-green-300 hover:bg-green-500/10 shrink-0"
                    title={t.addThis}
                    data-testid={`button-confirm-stun-url-${index}`}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                ) : confirmedStunUrls[index] ? (
                  <div className="h-9 w-9 flex items-center justify-center text-green-500 shrink-0">
                    <Check className="w-4 h-4" />
                  </div>
                ) : (
                  <div className="h-9 w-9 shrink-0" />
                )}
                {stunUrls.length > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => handleRemoveStunUrl(index)}
                    className="h-9 w-9 text-red-400 hover:text-red-300 hover:bg-red-500/10 shrink-0"
                    title={t.removeUrl}
                    data-testid={`button-remove-stun-url-${index}`}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddStunUrl}
                className="flex-1 border-dashed border-white/20 hover:border-primary/50 text-xs"
                data-testid="button-add-stun-url"
              >
                <Plus className="w-3 h-3 mr-1" />
                {t.addUrl}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestStunConnection}
                disabled={isTesting || isTestingStun}
                className={`border-white/10 text-xs ${
                  stunTestResult === 'success' ? 'border-green-500/50 text-green-400' : 
                  stunTestResult === 'failed' ? 'border-red-500/50 text-red-400' : ''
                }`}
                data-testid="button-test-stun-inline"
              >
                {isTestingStun ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <Radio className="w-3 h-3 mr-1" />
                )}
                {t.testStun}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground/50 flex items-start gap-2">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              {t.stunExample}
            </p>
          </div>

          {/* Username */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              <User className="w-4 h-4" />
              {t.username}
            </Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t.usernamePlaceholder}
              className="bg-black/20 border-white/10 focus:border-primary/50 font-mono"
              data-testid="input-turn-username"
            />
          </div>

          {/* Credential */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Lock className="w-4 h-4" />
              {t.credential}
            </Label>
            <Input
              type="password"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder={t.credentialPlaceholder}
              className="bg-black/20 border-white/10 focus:border-primary/50 font-mono"
              data-testid="input-turn-credential"
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="flex-1 border-white/10"
            data-testid="button-cancel-turn"
          >
            {t.cancel}
          </Button>
          <Button
            onClick={handleSubmit}
            className="flex-1 bg-primary hover:bg-primary/90"
            data-testid="button-submit-turn"
          >
            {t.connect}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
