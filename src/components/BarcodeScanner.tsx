import { useState, useEffect } from 'react';
import { useZxing } from 'react-zxing';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Camera, X, AlertCircle, ExternalLink, Keyboard } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
}

export default function BarcodeScanner({ onScan }: BarcodeScannerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [scannedCode, setScannedCode] = useState<string>('');
  const [manualCode, setManualCode] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [isInPreview, setIsInPreview] = useState(false);

  // Check if running in preview iframe
  useEffect(() => {
    try {
      setIsInPreview(window.self !== window.top);
    } catch (e) {
      setIsInPreview(true);
    }
  }, []);

  // Enumerate camera devices
  useEffect(() => {
    if (isOpen && !isInPreview) {
      navigator.mediaDevices.enumerateDevices()
        .then(deviceList => {
          const videoDevices = deviceList.filter(device => device.kind === 'videoinput');
          setDevices(videoDevices);
          if (videoDevices.length > 0 && !selectedDeviceId) {
            // Prefer back camera on mobile, or first USB camera on desktop
            const backCamera = videoDevices.find(d => d.label.toLowerCase().includes('back'));
            setSelectedDeviceId(backCamera?.deviceId || videoDevices[0].deviceId);
          }
        })
        .catch(err => {
          console.error('Error enumerating devices:', err);
          setCameraError('Unable to list camera devices. Please check browser permissions.');
        });
    }
  }, [isOpen, isInPreview]);

  const { ref } = useZxing({
    paused: !isOpen || isInPreview || showManualInput,
    timeBetweenDecodingAttempts: 300,
    constraints: {
      video: selectedDeviceId ? {
        deviceId: { exact: selectedDeviceId },
        width: { min: 640, ideal: 1280, max: 1920 },
        height: { min: 480, ideal: 720, max: 1080 }
      } : {
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
      setManualCode('');
      setShowManualInput(false);
    }
  }, [isOpen]);

  const handleManualSubmit = () => {
    if (manualCode.trim()) {
      onScan(manualCode.trim());
      toast.success(`Barcode entered: ${manualCode.trim()}`);
      setIsOpen(false);
      setManualCode('');
    } else {
      toast.error('Please enter a barcode');
    }
  };

  const handleDeviceChange = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setCameraError(null);
  };

  const openInNewTab = () => {
    window.open(window.location.href, '_blank');
  };

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
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Scan Barcode</DialogTitle>
            <DialogDescription>
              Use your camera to scan a barcode or enter it manually
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {isInPreview && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-sm">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <div className="space-y-2">
                    <p className="text-yellow-900 dark:text-yellow-200 font-medium">
                      Camera unavailable in preview
                    </p>
                    <p className="text-yellow-800 dark:text-yellow-300 text-xs">
                      Open app in a new tab to enable camera scanning
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openInNewTab}
                      className="mt-2"
                    >
                      <ExternalLink className="mr-2 h-3 w-3" />
                      Open in New Tab
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {!isInPreview && !showManualInput && (
              <>
                {devices.length > 1 && (
                  <div className="space-y-2">
                    <Label>Select Camera</Label>
                    <Select value={selectedDeviceId} onValueChange={handleDeviceChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose camera..." />
                      </SelectTrigger>
                      <SelectContent>
                        {devices.map(device => (
                          <SelectItem key={device.deviceId} value={device.deviceId}>
                            {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted" style={{ minHeight: '300px' }}>
                  {cameraError ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                      <AlertCircle className="h-12 w-12 text-destructive mb-3" />
                      <p className="text-sm text-muted-foreground">{cameraError}</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Make sure camera permissions are enabled in your browser settings
                      </p>
                      {devices.length === 0 && (
                        <p className="text-xs text-muted-foreground mt-2">
                          No camera detected. Try plugging in a USB camera or use manual entry.
                        </p>
                      )}
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
              </>
            )}

            {(showManualInput || isInPreview) && (
              <div className="space-y-3">
                <Label htmlFor="manual-barcode">Enter Barcode Manually</Label>
                <Input
                  id="manual-barcode"
                  type="text"
                  placeholder="Type or paste barcode..."
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                />
                <Button onClick={handleManualSubmit} className="w-full">
                  Submit Barcode
                </Button>
              </div>
            )}

            <div className="flex gap-2">
              {!isInPreview && (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowManualInput(!showManualInput)}
                >
                  <Keyboard className="mr-2 h-4 w-4" />
                  {showManualInput ? 'Use Camera' : 'Type Manually'}
                </Button>
              )}
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setIsOpen(false)}
              >
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
