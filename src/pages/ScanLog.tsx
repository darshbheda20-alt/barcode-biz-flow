import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { QrCode, PackagePlus, Package, AlertTriangle, X, Undo2, Edit3, XCircle } from "lucide-react";
import { z } from "zod";
import { getUserFriendlyError } from "@/lib/errorHandling";
import BarcodeScanner from "@/components/BarcodeScanner";

const scanSchema = z.object({
  barcode: z.string().trim().min(1, "Barcode is required").max(100, "Barcode must be less than 100 characters"),
  quantity: z.number().int("Quantity must be a whole number").positive("Quantity must be positive").max(10000, "Quantity cannot exceed 10,000"),
  orderId: z.string().max(100, "Order ID must be less than 100 characters").optional(),
  packetId: z.string().max(100, "Packet ID must be less than 100 characters").optional(),
  tagId: z.string().max(100, "Tag ID must be less than 100 characters").optional(),
  platform: z.string().min(1, "Platform is required").max(50, "Platform must be less than 50 characters").optional(),
});

const platforms = ["Amazon", "Flipkart", "Myntra", "Meesho", "Other"];

type Product = {
  id: string;
  name: string;
  master_sku: string;
  color: string | null;
  brand_size: string | null;
  standard_size: string | null;
  available_units: number;
};

export default function ScanLog() {
  const [activeMode, setActiveMode] = useState<"receive" | "pick" | "damage">("receive");
  const [loading, setLoading] = useState(false);

  // Receive section state
  const [scannedBarcode, setScannedBarcode] = useState("");
  const lastScanTimeRef = useRef<number>(0);
  
  // Session state
  const [sessionMode, setSessionMode] = useState(false);
  const [lastBarcode, setLastBarcode] = useState("");
  const [lastSelectedMasterSKU, setLastSelectedMasterSKU] = useState("");
  const [consecutiveCount, setConsecutiveCount] = useState(0);
  const [sessionScans, setSessionScans] = useState<Array<{sku: string, qty: number}>>([]);

  // UI state
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationProduct, setConfirmationProduct] = useState<Product | null>(null);
  const [showSKUSelector, setShowSKUSelector] = useState(false);
  const [candidateProducts, setCandidateProducts] = useState<Product[]>([]);
  const [showUnmappedModal, setShowUnmappedModal] = useState(false);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [showQuantityEdit, setShowQuantityEdit] = useState(false);
  const [editQuantity, setEditQuantity] = useState("1");
  const [permanentMap, setPermanentMap] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [receiveData, setReceiveData] = useState({
    barcode: "",
    quantity: "",
  });

  const [pickData, setPickData] = useState({
    barcode: "",
    quantity: "",
    platform: "",
    orderId: "",
    packetId: "",
    tagId: "",
  });

  const [damageData, setDamageData] = useState({
    barcode: "",
    quantity: "",
  });

  // Prevent double scans within 300ms
  const isDuplicateScan = (barcode: string): boolean => {
    const now = Date.now();
    if (barcode === lastBarcode && now - lastScanTimeRef.current < 300) {
      return true;
    }
    lastScanTimeRef.current = now;
    return false;
  };

  // Resolve barcode to product(s)
  const resolveBarcodeToProducts = async (barcode: string): Promise<Product[]> => {
    // Check sku_aliases
    const { data: aliases } = await supabase
      .from("sku_aliases")
      .select("product_id")
      .eq("alias_type", "barcode")
      .eq("alias_value", barcode);

    // Check products table
    const { data: directProducts } = await supabase
      .from("products")
      .select("id, name, master_sku, color, brand_size, standard_size, available_units")
      .eq("barcode", barcode);

    const productIds = new Set<string>();
    aliases?.forEach(a => productIds.add(a.product_id));
    directProducts?.forEach(p => productIds.add(p.id));

    if (productIds.size === 0) return [];

    const { data: products } = await supabase
      .from("products")
      .select("id, name, master_sku, color, brand_size, standard_size, available_units")
      .in("id", Array.from(productIds));

    return products || [];
  };

  // Handle barcode scan
  const handleBarcodeScan = async (barcode: string) => {
    if (isDuplicateScan(barcode)) return;

    setScannedBarcode(barcode);

    // In session mode, auto-add if same barcode
    if (sessionMode && barcode === lastBarcode) {
      await addStock(lastSelectedMasterSKU, 1);
      setConsecutiveCount(prev => prev + 1);
      toast.success(`Auto-added +1 (${consecutiveCount + 1})`);
      return;
    }

    // Different barcode breaks session mode
    if (sessionMode && barcode !== lastBarcode) {
      setSessionMode(false);
      setConsecutiveCount(0);
      toast.info("Session mode ended - different barcode");
    }

    const products = await resolveBarcodeToProducts(barcode);

    if (products.length === 0) {
      // No match - show unmapped modal
      setShowUnmappedModal(true);
    } else if (products.length === 1) {
      // Exact match - show confirmation
      setConfirmationProduct(products[0]);
      setShowConfirmation(true);
    } else {
      // Multiple matches - show selector
      setCandidateProducts(products);
      setShowSKUSelector(true);
    }
  };

  // Add stock to database
  const addStock = async (masterSKU: string, qty: number, permanent = false) => {
    const { data: product } = await supabase
      .from("products")
      .select("id")
      .eq("master_sku", masterSKU)
      .single();

    if (!product) {
      toast.error("Product not found");
      return;
    }

    const { error } = await supabase.from("scan_logs").insert({
      product_id: product.id,
      scan_mode: "receive",
      quantity: qty,
    });

    if (error) {
      toast.error(getUserFriendlyError(error));
      return;
    }

    // If permanent mapping requested, save to sku_aliases
    if (permanent && scannedBarcode) {
      await supabase.from("sku_aliases").insert({
        product_id: product.id,
        alias_type: "barcode",
        alias_value: scannedBarcode,
        marketplace: "internal",
      });
    }

    setSessionScans(prev => [...prev, { sku: masterSKU, qty }]);
  };

  // Handle confirmation (single match)
  const handleConfirmSingle = async (customQty?: number) => {
    if (!confirmationProduct) return;

    const qty = customQty || 1;
    await addStock(confirmationProduct.master_sku, qty, permanentMap);

    setLastBarcode(scannedBarcode);
    setLastSelectedMasterSKU(confirmationProduct.master_sku);
    setConsecutiveCount(prev => prev + 1);

    // Check if we hit 5 consecutive
    if (consecutiveCount + 1 >= 5 && !sessionMode) {
      setShowSessionModal(true);
    } else {
      toast.success(`Stock received: +${qty}`);
    }

    setShowConfirmation(false);
    setConfirmationProduct(null);
    setPermanentMap(false);
  };

  // Handle SKU selection (multiple matches)
  const handleSKUSelect = async (product: Product) => {
    await addStock(product.master_sku, 1, permanentMap);

    setLastBarcode(scannedBarcode);
    setLastSelectedMasterSKU(product.master_sku);
    setConsecutiveCount(1);

    toast.success(`Mapped to ${product.master_sku}`);
    setShowSKUSelector(false);
    setCandidateProducts([]);
    setPermanentMap(false);
  };

  // Enable session auto-add mode
  const enableSessionMode = () => {
    setSessionMode(true);
    setShowSessionModal(false);
    toast.success(`Auto-add enabled for ${lastSelectedMasterSKU}`);
  };

  // Stop session mode
  const stopSessionMode = () => {
    setSessionMode(false);
    setConsecutiveCount(0);
    setShowSessionModal(false);
    toast.info("Session stopped");
  };

  // Undo last scan
  const handleUndo = () => {
    if (sessionScans.length === 0) {
      toast.error("No scans to undo");
      return;
    }
    // In real implementation, would delete last scan_log entry
    const last = sessionScans[sessionScans.length - 1];
    setSessionScans(prev => prev.slice(0, -1));
    setConsecutiveCount(prev => Math.max(0, prev - 1));
    toast.success(`Undone: ${last.sku} -${last.qty}`);
  };

  const handleReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleBarcodeScan(receiveData.barcode);
    setReceiveData({ barcode: "", quantity: "" });
  };

  const handlePick = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const validation = scanSchema.safeParse({
        barcode: pickData.barcode,
        quantity: parseInt(pickData.quantity),
        orderId: pickData.orderId,
        packetId: pickData.packetId,
        tagId: pickData.tagId,
        platform: pickData.platform,
      });

      if (!validation.success) {
        toast.error(validation.error.issues[0].message);
        setLoading(false);
        return;
      }

      const { data: product, error: productError } = await supabase
        .from("products")
        .select("*")
        .eq("barcode", validation.data.barcode)
        .single();

      if (productError || !product) {
        toast.error("Product not found with this barcode");
        return;
      }

      if (product.available_units < validation.data.quantity) {
        toast.error("Insufficient stock available");
        return;
      }

      const { error: scanError } = await supabase.from("scan_logs").insert({
        product_id: product.id,
        scan_mode: "pick",
        quantity: validation.data.quantity,
        order_id: validation.data.orderId || null,
        packet_id: validation.data.packetId || null,
        tag_id: validation.data.tagId || null,
        platform: validation.data.platform || null,
      });

      if (scanError) throw scanError;

      const { error: orderError } = await supabase.from("sales_orders").insert({
        order_id: validation.data.orderId!,
        packet_id: validation.data.packetId || null,
        tag_id: validation.data.tagId || null,
        platform: validation.data.platform!,
        product_id: product.id,
        quantity: validation.data.quantity,
      });

      if (orderError) throw orderError;

      toast.success("Order picked successfully!");
      setPickData({
        barcode: "",
        quantity: "",
        platform: "",
        orderId: "",
        packetId: "",
        tagId: "",
      });
    } catch (error: any) {
      console.error("Error picking order:", error);
      toast.error(getUserFriendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleDamage = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const validation = scanSchema.safeParse({
        barcode: damageData.barcode,
        quantity: parseInt(damageData.quantity),
      });

      if (!validation.success) {
        toast.error(validation.error.issues[0].message);
        setLoading(false);
        return;
      }

      const { data: product, error: productError } = await supabase
        .from("products")
        .select("id")
        .eq("barcode", validation.data.barcode)
        .single();

      if (productError || !product) {
        toast.error("Product not found with this barcode");
        return;
      }

      const { error } = await supabase.from("scan_logs").insert({
        product_id: product.id,
        scan_mode: "damage",
        quantity: validation.data.quantity,
      });

      if (error) throw error;

      toast.success("Damage recorded successfully!");
      setDamageData({ barcode: "", quantity: "" });
    } catch (error: any) {
      console.error("Error recording damage:", error);
      toast.error(getUserFriendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Scan Log</h1>
        <p className="text-muted-foreground">Record stock movements through scanning</p>
      </div>

      <Tabs value={activeMode} onValueChange={(v) => setActiveMode(v as any)}>
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="receive">
            <PackagePlus className="mr-2 h-4 w-4" />
            Receive
          </TabsTrigger>
          <TabsTrigger value="pick">
            <Package className="mr-2 h-4 w-4" />
            Pick
          </TabsTrigger>
          <TabsTrigger value="damage">
            <AlertTriangle className="mr-2 h-4 w-4" />
            Damage
          </TabsTrigger>
        </TabsList>

        <TabsContent value="receive">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-success" />
                Receive Stock
              </CardTitle>
              <CardDescription>Scan products to add to available inventory</CardDescription>
            </CardHeader>
            <CardContent>
              {sessionMode && (
                <div className="mb-4 p-3 bg-primary/10 border border-primary rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    <span className="font-medium">Auto-Add Mode: {lastSelectedMasterSKU}</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={stopSessionMode}>
                    <X className="h-4 w-4 mr-1" />
                    Stop
                  </Button>
                </div>
              )}

              <div className="space-y-4">
                <BarcodeScanner onScan={handleBarcodeScan} />

                <form onSubmit={handleReceive} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="receive-barcode">Or Enter Barcode Manually</Label>
                    <Input
                      id="receive-barcode"
                      placeholder="Enter barcode"
                      value={receiveData.barcode}
                      onChange={(e) => setReceiveData({ ...receiveData, barcode: e.target.value })}
                    />
                  </div>
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Processing..." : "Submit"}
                  </Button>
                </form>

                {sessionScans.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Session Scans ({sessionScans.length})</Label>
                      <Button variant="ghost" size="sm" onClick={handleUndo}>
                        <Undo2 className="h-4 w-4 mr-1" />
                        Undo
                      </Button>
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1 text-sm">
                      {sessionScans.map((scan, i) => (
                        <div key={i} className="flex justify-between p-2 bg-muted/50 rounded">
                          <span>{scan.sku}</span>
                          <span>+{scan.qty}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Confirmation Modal - Single Match */}
          <Dialog open={showConfirmation} onOpenChange={setShowConfirmation}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm Product</DialogTitle>
                <DialogDescription>Verify this is the correct product</DialogDescription>
              </DialogHeader>
              
              {confirmationProduct && (
                <div className="space-y-4">
                  <div className="p-4 bg-muted rounded-lg space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Product:</span>
                      <span className="font-medium">{confirmationProduct.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Master SKU:</span>
                      <span className="font-mono font-bold">{confirmationProduct.master_sku}</span>
                    </div>
                    {confirmationProduct.brand_size && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Size:</span>
                        <span>{confirmationProduct.brand_size}</span>
                      </div>
                    )}
                    {confirmationProduct.color && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Color:</span>
                        <span>{confirmationProduct.color}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Available:</span>
                      <span className="font-medium">{confirmationProduct.available_units} units</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="permanent-map" 
                      checked={permanentMap}
                      onCheckedChange={(checked) => setPermanentMap(checked as boolean)}
                    />
                    <label htmlFor="permanent-map" className="text-sm cursor-pointer">
                      Always map this barcode to this SKU
                    </label>
                  </div>
                </div>
              )}

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setShowConfirmation(false)}>
                  Cancel
                </Button>
                <Button variant="outline" onClick={() => {
                  setShowConfirmation(false);
                  setShowSKUSelector(true);
                  setCandidateProducts(confirmationProduct ? [confirmationProduct] : []);
                }}>
                  Change SKU
                </Button>
                <Button variant="outline" onClick={() => {
                  setShowQuantityEdit(true);
                  setShowConfirmation(false);
                }}>
                  <Edit3 className="h-4 w-4 mr-1" />
                  Edit Qty
                </Button>
                <Button onClick={() => handleConfirmSingle()}>
                  Confirm (+1)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Quantity Edit Modal */}
          <Dialog open={showQuantityEdit} onOpenChange={setShowQuantityEdit}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Quantity</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    min="1"
                    value={editQuantity}
                    onChange={(e) => setEditQuantity(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowQuantityEdit(false)}>
                  Cancel
                </Button>
                <Button onClick={() => {
                  handleConfirmSingle(parseInt(editQuantity));
                  setShowQuantityEdit(false);
                  setEditQuantity("1");
                }}>
                  Confirm
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* SKU Selector Modal - Multiple Matches */}
          <Dialog open={showSKUSelector} onOpenChange={setShowSKUSelector}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Select Correct Master SKU</DialogTitle>
                <DialogDescription>Multiple products share this barcode</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="permanent-map-multi" 
                    checked={permanentMap}
                    onCheckedChange={(checked) => setPermanentMap(checked as boolean)}
                  />
                  <label htmlFor="permanent-map-multi" className="text-sm cursor-pointer">
                    Always map this barcode to selected SKU
                  </label>
                </div>

                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {candidateProducts.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => handleSKUSelect(product)}
                      className="w-full p-4 border rounded-lg hover:bg-muted/50 text-left transition-colors"
                    >
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium">{product.name}</div>
                            <div className="font-mono text-sm text-primary">{product.master_sku}</div>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Stock: {product.available_units}
                          </div>
                        </div>
                        <div className="flex gap-4 text-sm text-muted-foreground">
                          {product.brand_size && <span>Size: {product.brand_size}</span>}
                          {product.color && <span>Color: {product.color}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowSKUSelector(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Unmapped Barcode Modal */}
          <Dialog open={showUnmappedModal} onOpenChange={setShowUnmappedModal}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Barcode Not Recognized</DialogTitle>
                <DialogDescription>
                  Barcode: <span className="font-mono font-bold">{scannedBarcode}</span>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Search Existing Products</Label>
                  <Input
                    placeholder="Search by SKU or name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="permanent-map-new" 
                      checked={permanentMap}
                      onCheckedChange={(checked) => setPermanentMap(checked as boolean)}
                    />
                    <label htmlFor="permanent-map-new" className="text-sm cursor-pointer">
                      Always map this barcode to selected SKU
                    </label>
                  </div>
                </div>

                <div className="text-sm text-muted-foreground">
                  To create a new product, go to Product Management
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => {
                  setShowUnmappedModal(false);
                  setPermanentMap(false);
                }}>
                  Skip
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Session Modal - 5 consecutive scans */}
          <Dialog open={showSessionModal} onOpenChange={setShowSessionModal}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Continue with Same SKU?</DialogTitle>
                <DialogDescription>
                  You've scanned 5 units of {lastSelectedMasterSKU}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <p className="text-sm text-muted-foreground">
                  Enable auto-add mode to automatically add +1 for each scan of the same barcode without confirmation.
                </p>
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={stopSessionMode}>
                  Stop
                </Button>
                <Button variant="outline" onClick={() => {
                  setShowSessionModal(false);
                  setShowSKUSelector(true);
                }}>
                  Change SKU
                </Button>
                <Button onClick={enableSessionMode}>
                  Yes — Continue Auto-Add
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="pick">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-primary" />
                Pick for Order
              </CardTitle>
              <CardDescription>Scan products to fulfill orders and reduce stock</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePick} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="pick-platform">Platform *</Label>
                    <Select
                      value={pickData.platform}
                      onValueChange={(value) =>
                        setPickData({ ...pickData, platform: value })
                      }
                      required
                    >
                      <SelectTrigger id="pick-platform">
                        <SelectValue placeholder="Select platform" />
                      </SelectTrigger>
                      <SelectContent>
                        {platforms.map((platform) => (
                          <SelectItem key={platform} value={platform}>
                            {platform}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pick-order-id">Order ID *</Label>
                    <Input
                      id="pick-order-id"
                      placeholder="Enter order ID"
                      required
                      value={pickData.orderId}
                      onChange={(e) =>
                        setPickData({ ...pickData, orderId: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pick-packet-id">Packet ID</Label>
                    <Input
                      id="pick-packet-id"
                      placeholder="Enter packet ID"
                      value={pickData.packetId}
                      onChange={(e) =>
                        setPickData({ ...pickData, packetId: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pick-tag-id">Tag ID</Label>
                    <Input
                      id="pick-tag-id"
                      placeholder="Enter tag ID"
                      value={pickData.tagId}
                      onChange={(e) =>
                        setPickData({ ...pickData, tagId: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pick-barcode">Product Barcode *</Label>
                  <Input
                    id="pick-barcode"
                    placeholder="Scan or enter barcode"
                    required
                    value={pickData.barcode}
                    onChange={(e) =>
                      setPickData({ ...pickData, barcode: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pick-quantity">Quantity *</Label>
                  <Input
                    id="pick-quantity"
                    type="number"
                    min="1"
                    required
                    value={pickData.quantity}
                    onChange={(e) =>
                      setPickData({ ...pickData, quantity: e.target.value })
                    }
                  />
                </div>

                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? "Processing..." : "Submit Pick"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="damage">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-destructive" />
                Record Damage
              </CardTitle>
              <CardDescription>Scan damaged products to track losses</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleDamage} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="damage-barcode">Product Barcode *</Label>
                  <Input
                    id="damage-barcode"
                    placeholder="Scan or enter barcode"
                    required
                    value={damageData.barcode}
                    onChange={(e) =>
                      setDamageData({ ...damageData, barcode: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="damage-quantity">Damaged Quantity *</Label>
                  <Input
                    id="damage-quantity"
                    type="number"
                    min="1"
                    required
                    value={damageData.quantity}
                    onChange={(e) =>
                      setDamageData({ ...damageData, quantity: e.target.value })
                    }
                  />
                </div>
                <Button
                  type="submit"
                  disabled={loading}
                  variant="destructive"
                  className="w-full"
                >
                  {loading ? "Processing..." : "Submit Damage"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
