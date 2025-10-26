import { useState, useEffect } from 'react';
import { useZxing } from 'react-zxing';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Camera, X, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
}

export default function BarcodeScanner({ onScan }: BarcodeScannerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [scannedCode, setScannedCode] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);

  const { ref } = useZxing({
    paused: !isOpen,
    timeBetweenDecodingAttempts: 300,
    constraints: {
      video: {
        facingMode: { ideal: 'environment' },
        width: { min: 640, ideal: 1280, max: 1920 },
        height: { min: 480, ideal: 720, max: 1080 }
      },
      audio: false
    },
    onDecodeResult(result) {
      const code = result.getText();
      setScannedCode(code);
      onScan(code);
      toast.success(`Barcode scanned: ${code}`);
      setIsOpen(false);
    },
    onError(error) {
      console.error('Camera error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.toLowerCase().includes('permission') || 
          errorMessage.toLowerCase().includes('denied')) {
        setCameraError('Camera permission denied. Please allow camera access in your browser settings.');
        toast.error('Camera access denied');
      } else if (errorMessage.toLowerCase().includes('notfound') || 
                 errorMessage.toLowerCase().includes('not found')) {
        setCameraError('No camera found. Please connect a camera and try again.');
        toast.error('No camera detected');
      } else {
        setCameraError('Unable to access camera. Please check your camera settings.');
        toast.error('Camera error');
      }
    },
  });

  useEffect(() => {
    if (!isOpen) {
      setCameraError(null);
    }
  }, [isOpen]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => setIsOpen(true)}
        title="Scan barcode with camera"
      >
        <Camera className="h-4 w-4" />
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Scan Barcode</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted" style={{ minHeight: '300px' }}>
              {cameraError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                  <AlertCircle className="h-12 w-12 text-destructive mb-3" />
                  <p className="text-sm text-muted-foreground">{cameraError}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Make sure camera permissions are enabled in your browser settings
                  </p>
                </div>
              ) : (
                <video
                  ref={ref}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  className="absolute inset-0"
                />
              )}
            </div>
            {!cameraError && (
              <p className="text-sm text-muted-foreground text-center">
                Position the barcode within the camera view
              </p>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setIsOpen(false)}
            >
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
