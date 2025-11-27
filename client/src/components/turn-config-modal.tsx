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
import { Server, Lock, User, AlertCircle } from "lucide-react";
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
    serverUrlPlaceholder: "turn:your-server.com:3478",
    username: "Username",
    usernamePlaceholder: "turn-username",
    credential: "Credential",
    credentialPlaceholder: "turn-password",
    addUrl: "Add Another URL",
    removeUrl: "Remove",
    connect: "Connect Securely",
    cancel: "Cancel",
    invalidUrl: "Invalid TURN URL format",
    requiredFields: "All fields are required",
    example: "Example: turn:relay.example.com:3478 or turns:relay.example.com:5349",
  },
  ar: {
    title: "تكوين خادم TURN",
    description: "أدخل تفاصيل خادم TURN الخاص بك. سيتم توجيه جميع الاتصالات عبر هذا المُرحّل لمنع تسرب عنوان IP.",
    serverUrl: "عنوان URL لخادم TURN",
    serverUrlPlaceholder: "turn:your-server.com:3478",
    username: "اسم المستخدم",
    usernamePlaceholder: "turn-username",
    credential: "كلمة المرور",
    credentialPlaceholder: "turn-password",
    addUrl: "إضافة عنوان URL آخر",
    removeUrl: "إزالة",
    connect: "اتصال آمن",
    cancel: "إلغاء",
    invalidUrl: "تنسيق URL غير صالح لـ TURN",
    requiredFields: "جميع الحقول مطلوبة",
    example: "مثال: turn:relay.example.com:3478 أو turns:relay.example.com:5349",
  }
};

export function TurnConfigModal({ open, onConfigured, onCancel, language = 'en' }: TurnConfigModalProps) {
  const [urls, setUrls] = useState<string[]>([""]);
  const [username, setUsername] = useState("");
  const [credential, setCredential] = useState("");

  const t = translations[language];

  const validateTurnUrl = (url: string): boolean => {
    // TURN URLs format: turn:hostname:port or turns:hostname:port
    return /^turns?:[^:]+:\d+$/.test(url.trim());
  };

  const handleAddUrl = () => {
    setUrls([...urls, ""]);
  };

  const handleRemoveUrl = (index: number) => {
    if (urls.length > 1) {
      setUrls(urls.filter((_, i) => i !== index));
    }
  };

  const handleUrlChange = (index: number, value: string) => {
    const newUrls = [...urls];
    newUrls[index] = value;
    setUrls(newUrls);
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
              <div key={index} className="flex gap-2">
                <Input
                  value={url}
                  onChange={(e) => handleUrlChange(index, e.target.value)}
                  placeholder={t.serverUrlPlaceholder}
                  className="flex-1 bg-black/20 border-white/10 focus:border-primary/50 font-mono text-sm"
                  data-testid={`input-turn-url-${index}`}
                />
                {urls.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveUrl(index)}
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    data-testid={`button-remove-url-${index}`}
                  >
                    {t.removeUrl}
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
