import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Camera, X, AlertCircle, ExternalLink, Keyboard, Zap, ZapOff, Crosshair, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
}

export default function BarcodeScanner({ onScan }: BarcodeScannerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [manualCode, setManualCode] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [isInPreview, setIsInPreview] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [isDecoding, setIsDecoding] = useState(false);
  const [roiScale, setRoiScale] = useState(0.6);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState({
    fps: 0,
    avgDecodeTime: 0,
    successRate: 0,
    attempts: 0,
    successes: 0,
    resolution: ''
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const fpsCounterRef = useRef<number[]>([]);
  const decodeTimesRef = useRef<number[]>([]);
  const decodingRef = useRef<boolean>(false);

  // Check if running in preview iframe
  useEffect(() => {
    try {
      setIsInPreview(window.self !== window.top);
    } catch (e) {
      setIsInPreview(true);
    }
  }, []);

  // Initialize Web Worker
  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/barcodeDecoder.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e: MessageEvent) => {
      const { success, barcode, decodeTime, error } = e.data;
      
      setIsDecoding(false);
      decodingRef.current = false;

      // Update decode times
      decodeTimesRef.current.push(decodeTime);
      if (decodeTimesRef.current.length > 10) {
        decodeTimesRef.current.shift();
      }

      // Update diagnostics
      setDiagnostics(prev => {
        const newAttempts = prev.attempts + 1;
        const newSuccesses = success ? prev.successes + 1 : prev.successes;
        const avgDecodeTime = decodeTimesRef.current.reduce((a, b) => a + b, 0) / decodeTimesRef.current.length;
        
        return {
          ...prev,
          avgDecodeTime: Math.round(avgDecodeTime),
          attempts: newAttempts,
          successes: newSuccesses,
          successRate: Math.round((newSuccesses / newAttempts) * 100)
        };
      });

      if (success && barcode) {
        // Haptic feedback
        if ('vibrate' in navigator) {
          navigator.vibrate(200);
        }

        // Audio feedback
        try {
          const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZUQ0PVqzn77BdGAg+ltryxnYmBSuAzvLaiTcIGWi77een');
          audio.play().catch(() => {}); // Ignore errors
        } catch (e) {
          // Audio not supported
        }

        onScan(barcode);
        toast.success(`Barcode scanned: ${barcode}`);
        stopCamera();
        setIsOpen(false);
      }

      if (error) {
        console.error('Decode error:', error);
      }
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
    };
  }, [onScan]);

  // Enumerate camera devices
  useEffect(() => {
    if (isOpen && !isInPreview && !showManualInput) {
      navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      })
        .then(stream => {
          stream.getTracks().forEach(track => track.stop());
          return navigator.mediaDevices.enumerateDevices();
        })
        .then(deviceList => {
          const videoDevices = deviceList.filter(device => device.kind === 'videoinput');
          setDevices(videoDevices);
          
          if (videoDevices.length > 0 && !selectedDeviceId) {
            const backCamera = videoDevices.find(d => 
              d.label.toLowerCase().includes('back') || 
              d.label.toLowerCase().includes('rear') ||
              d.label.toLowerCase().includes('environment')
            );
            setSelectedDeviceId(backCamera?.deviceId || videoDevices[0].deviceId);
          }
        })
        .catch(err => {
          console.error('Error accessing camera:', err);
          handleCameraError(err);
        });
    }
  }, [isOpen, isInPreview, showManualInput, selectedDeviceId]);

  // Start camera
  useEffect(() => {
    if (isOpen && !isInPreview && !showManualInput && selectedDeviceId) {
      startCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isOpen, isInPreview, showManualInput, selectedDeviceId]);

  const handleCameraError = (err: any) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    if (errorMessage.toLowerCase().includes('permission') || 
        errorMessage.toLowerCase().includes('denied') ||
        err.name === 'NotAllowedError') {
      setCameraError('Camera permission denied. Please enable camera access in your browser settings.');
    } else if (errorMessage.toLowerCase().includes('notfound') || 
               err.name === 'NotFoundError') {
      setCameraError('No camera found on this device.');
    } else {
      setCameraError('Unable to access camera. Please check your settings and try again.');
    }
  };

  const startCamera = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          facingMode: selectedDeviceId ? undefined : 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        // Check torch support
        const track = stream.getVideoTracks()[0];
        const capabilities = track.getCapabilities?.() as any;
        setTorchSupported(capabilities?.torch === true);

        // Get actual resolution
        const settings = track.getSettings();
        setDiagnostics(prev => ({
          ...prev,
          resolution: `${settings.width}x${settings.height}`
        }));

        // Start decoding loop
        startDecodingLoop();
      }

      setCameraError(null);
    } catch (err) {
      console.error('Error starting camera:', err);
      handleCameraError(err);
    }
  };

  const stopCamera = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setTorchEnabled(false);
    decodingRef.current = false;
  };

  const toggleTorch = async () => {
    if (!streamRef.current || !torchSupported) return;

    const track = streamRef.current.getVideoTracks()[0];
    const newTorchState = !torchEnabled;

    try {
      await track.applyConstraints({
        advanced: [{ torch: newTorchState } as any]
      });
      setTorchEnabled(newTorchState);
      toast.success(newTorchState ? 'Torch enabled' : 'Torch disabled');
    } catch (err) {
      console.error('Error toggling torch:', err);
      toast.error('Failed to toggle torch');
    }
  };

  const startDecodingLoop = () => {
    const decode = (timestamp: number) => {
      if (!videoRef.current || !canvasRef.current || !workerRef.current) {
        return;
      }

      // Calculate FPS
      if (lastFrameTimeRef.current) {
        const fps = 1000 / (timestamp - lastFrameTimeRef.current);
        fpsCounterRef.current.push(fps);
        if (fpsCounterRef.current.length > 10) {
          fpsCounterRef.current.shift();
        }
        const avgFps = fpsCounterRef.current.reduce((a, b) => a + b, 0) / fpsCounterRef.current.length;
        setDiagnostics(prev => ({ ...prev, fps: Math.round(avgFps) }));
      }
      lastFrameTimeRef.current = timestamp;

      // Only decode if not currently decoding
      if (!decodingRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (ctx) {
          // Calculate ROI
          const roiWidth = Math.floor(video.videoWidth * roiScale);
          const roiHeight = Math.floor(video.videoHeight * 0.4);
          const roiX = Math.floor((video.videoWidth - roiWidth) / 2);
          const roiY = Math.floor((video.videoHeight - roiHeight) / 2);

          // Set canvas to ROI size
          canvas.width = roiWidth;
          canvas.height = roiHeight;

          // Draw ROI to canvas
          ctx.drawImage(
            video,
            roiX, roiY, roiWidth, roiHeight,
            0, 0, roiWidth, roiHeight
          );

          // Get image data
          const imageData = ctx.getImageData(0, 0, roiWidth, roiHeight);

          // Send to worker
          decodingRef.current = true;
          setIsDecoding(true);
          workerRef.current.postMessage({ imageData });
        }
      }

      // Continue loop at ~24 fps
      setTimeout(() => {
        animationFrameRef.current = requestAnimationFrame(decode);
      }, 1000 / 24);
    };

    animationFrameRef.current = requestAnimationFrame(decode);
  };

  const captureStill = () => {
    if (!videoRef.current || !canvasRef.current || !workerRef.current) {
      toast.error('Camera not ready');
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
      // Capture full frame for manual capture
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      decodingRef.current = true;
      setIsDecoding(true);
      workerRef.current.postMessage({ imageData });
      
      toast.info('Processing image...');
    }
  };

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
    stopCamera();
    setSelectedDeviceId(deviceId);
    setCameraError(null);
  };

  const openInNewTab = () => {
    window.open(window.location.href, '_blank');
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setCameraError(null);
      setManualCode('');
      setShowManualInput(false);
      setDiagnostics({
        fps: 0,
        avgDecodeTime: 0,
        successRate: 0,
        attempts: 0,
        successes: 0,
        resolution: ''
      });
      fpsCounterRef.current = [];
      decodeTimesRef.current = [];
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
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Scan Barcode</span>
              {!isInPreview && !showManualInput && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowDiagnostics(!showDiagnostics)}
                  title="Toggle diagnostics"
                >
                  <Info className="h-4 w-4" />
                </Button>
              )}
            </DialogTitle>
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
                    </div>
                  ) : (
                    <>
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        className="absolute inset-0"
                      />
                      
                      {/* ROI Overlay */}
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div 
                          className="border-2 border-primary rounded-lg relative"
                          style={{ 
                            width: `${roiScale * 100}%`, 
                            height: '40%',
                            boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)'
                          }}
                        >
                          <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-primary rounded-tl-lg" />
                          <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-primary rounded-tr-lg" />
                          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-primary rounded-bl-lg" />
                          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-primary rounded-br-lg" />
                          <Crosshair className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 h-8 w-8 text-primary opacity-50" />
                        </div>
                      </div>

                      {/* Status indicator */}
                      {isDecoding && (
                        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-primary text-primary-foreground px-3 py-1 rounded-full text-sm font-medium animate-pulse">
                          Scanning...
                        </div>
                      )}
                    </>
                  )}
                  
                  {/* Hidden canvas for processing */}
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                </div>

                {!cameraError && (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground text-center">
                      Position the barcode within the highlighted area
                    </p>

                    {/* Controls */}
                    <div className="flex gap-2 flex-wrap">
                      {torchSupported && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={toggleTorch}
                          className="flex-1"
                        >
                          {torchEnabled ? (
                            <><Zap className="mr-2 h-4 w-4" />Torch On</>
                          ) : (
                            <><ZapOff className="mr-2 h-4 w-4" />Torch Off</>
                          )}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={captureStill}
                        className="flex-1"
                        disabled={isDecoding}
                      >
                        <Camera className="mr-2 h-4 w-4" />
                        Capture
                      </Button>
                    </div>

                    {/* ROI adjustment */}
                    <div className="space-y-2">
                      <Label className="text-xs">Scan Area Width: {Math.round(roiScale * 100)}%</Label>
                      <input
                        type="range"
                        min="40"
                        max="90"
                        step="5"
                        value={roiScale * 100}
                        onChange={(e) => setRoiScale(Number(e.target.value) / 100)}
                        className="w-full"
                      />
                    </div>

                    {/* Diagnostics */}
                    {showDiagnostics && (
                      <div className="bg-muted rounded-lg p-3 text-xs space-y-1 font-mono">
                        <div className="flex justify-between">
                          <span>Resolution:</span>
                          <span>{diagnostics.resolution}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>FPS:</span>
                          <span>{diagnostics.fps}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Avg Decode:</span>
                          <span>{diagnostics.avgDecodeTime}ms</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Success Rate:</span>
                          <span>{diagnostics.successRate}% ({diagnostics.successes}/{diagnostics.attempts})</span>
                        </div>
                      </div>
                    )}
                  </div>
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
                  autoFocus
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
                  onClick={() => {
                    setShowManualInput(!showManualInput);
                    if (!showManualInput) {
                      stopCamera();
                    }
                  }}
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
