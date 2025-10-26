import { useState } from 'react';
import { useZxing } from 'react-zxing';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Camera, X } from 'lucide-react';
import { toast } from 'sonner';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
}

export default function BarcodeScanner({ onScan }: BarcodeScannerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [scannedCode, setScannedCode] = useState<string>('');

  const { ref } = useZxing({
    paused: !isOpen,
    constraints: {
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    },
    onDecodeResult(result) {
      const code = result.getText();
      setScannedCode(code);
      onScan(code);
      toast.success(`Barcode scanned: ${code}`);
      setIsOpen(false);
    },
    onError(error) {
      console.error('Scan error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.toLowerCase().includes('permission')) {
        toast.error('Camera permission denied. Please allow camera access.');
      }
    },
  });

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
            <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted">
              <video
                ref={ref}
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Position the barcode within the camera view
            </p>
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
