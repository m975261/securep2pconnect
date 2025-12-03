import { useState } from "react";
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
import { Server, Lock, User, AlertCircle, Plus, Check, X } from "lucide-react";
import { toast } from "sonner";

export interface TurnConfig {
  urls: string[];
  username: string;
  credential: string;
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
    requiredFields: "All fields are required",
    example: "Example: turn:relay.com:3478?transport=udp or turns:relay.com:443?transport=tcp",
  },
  ar: {
    title: "تكوين خادم TURN",
    description: "أدخل تفاصيل خادم TURN الخاص بك. سيتم توجيه جميع الاتصالات عبر هذا المُرحّل لمنع تسرب عنوان IP.",
    serverUrl: "عنوان URL لخادم TURN",
    serverUrlPlaceholder: "turn:server.com:3478?transport=udp",
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
    requiredFields: "جميع الحقول مطلوبة",
    example: "مثال: turn:relay.com:3478?transport=udp أو turns:relay.com:443?transport=tcp",
  }
};

export function TurnConfigModal({ open, onConfigured, onCancel, language = 'en' }: TurnConfigModalProps) {
  const [urls, setUrls] = useState<string[]>([""]);
  const [confirmedUrls, setConfirmedUrls] = useState<boolean[]>([false]);
  const [username, setUsername] = useState("");
  const [credential, setCredential] = useState("");

  const t = translations[language];

  const validateTurnUrl = (url: string): boolean => {
    // TURN URLs format: turn:hostname:port or turns:hostname:port, optionally with ?transport=udp|tcp
    return /^turns?:[^:]+:\d+(\?transport=(udp|tcp))?$/.test(url.trim());
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

  const handleSubmit = () => {
    // Validate all fields
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

    const config: TurnConfig = {
      urls: validUrls,
      username: username.trim(),
      credential: credential.trim(),
    };

    // Store in localStorage for persistence
    localStorage.setItem('turn-config', JSON.stringify(config));
    
    onConfigured(config);
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[500px] bg-zinc-900 border-white/10" dir={language === 'ar' ? 'rtl' : 'ltr'}>
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
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddUrl}
              className="w-full border-dashed border-white/20 hover:border-primary/50"
              data-testid="button-add-url"
            >
              {t.addUrl}
            </Button>
            <p className="text-xs text-muted-foreground/50 flex items-start gap-2">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              {t.example}
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

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onCancel}
            className="border-white/10"
            data-testid="button-cancel-turn"
          >
            {t.cancel}
          </Button>
          <Button
            onClick={handleSubmit}
            className="bg-primary hover:bg-primary/90"
            data-testid="button-submit-turn"
          >
            {t.connect}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
