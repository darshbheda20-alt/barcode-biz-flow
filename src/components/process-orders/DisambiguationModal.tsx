import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

interface ProductCandidate {
  id: string;
  master_sku: string;
  name: string;
  brand_size: string | null;
  color: string | null;
  available_units: number;
  barcode: string | null;
}

interface DisambiguationModalProps {
  open: boolean;
  onClose: () => void;
  candidates: ProductCandidate[];
  barcode: string;
  onSelect: (candidate: ProductCandidate, applyToNext: boolean) => void;
}

export function DisambiguationModal({
  open,
  onClose,
  candidates,
  barcode,
  onSelect,
}: DisambiguationModalProps) {
  const [selectedCandidate, setSelectedCandidate] = useState<ProductCandidate | null>(null);
  const [applyToNext, setApplyToNext] = useState(false);

  const handleConfirm = () => {
    if (selectedCandidate) {
      onSelect(selectedCandidate, applyToNext);
      setSelectedCandidate(null);
      setApplyToNext(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select Correct Master SKU</DialogTitle>
          <DialogDescription>
            Multiple products share this barcode. Choose the correct product for this scan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted p-3 rounded">
            <p className="text-sm font-medium">Scanned Barcode:</p>
            <p className="font-mono">{barcode}</p>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {candidates.map((candidate) => (
              <div
                key={candidate.id}
                className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                  selectedCandidate?.id === candidate.id
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-primary/50'
                }`}
                onClick={() => setSelectedCandidate(candidate)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-semibold">{candidate.master_sku}</p>
                    <p className="text-sm text-muted-foreground">{candidate.name}</p>
                    <div className="flex gap-2 mt-2">
                      {candidate.brand_size && (
                        <Badge variant="outline">{candidate.brand_size}</Badge>
                      )}
                      {candidate.color && (
                        <Badge variant="outline">{candidate.color}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Available</p>
                    <p className="text-lg font-semibold">{candidate.available_units}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-start space-x-2 bg-blue-50 p-4 rounded">
            <Checkbox
              id="apply-to-next"
              checked={applyToNext}
              onCheckedChange={(checked) => setApplyToNext(checked as boolean)}
            />
            <div className="grid gap-1.5 leading-none">
              <label
                htmlFor="apply-to-next"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Apply to next scans (up to 5)
              </label>
              <p className="text-sm text-muted-foreground">
                If checked, this SKU will be auto-selected for the next scans of this barcode; you will be re-prompted after every 5 scans.
              </p>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!selectedCandidate}
            >
              Confirm (+1)
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
