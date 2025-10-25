import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { QrCode, PackagePlus, Package, AlertTriangle } from "lucide-react";
import { z } from "zod";

const scanSchema = z.object({
  barcode: z.string().trim().min(1, "Barcode is required").max(100, "Barcode must be less than 100 characters"),
  quantity: z.number().int("Quantity must be a whole number").positive("Quantity must be positive").max(10000, "Quantity cannot exceed 10,000"),
  orderId: z.string().max(100, "Order ID must be less than 100 characters").optional(),
  packetId: z.string().max(100, "Packet ID must be less than 100 characters").optional(),
  tagId: z.string().max(100, "Tag ID must be less than 100 characters").optional(),
  platform: z.string().min(1, "Platform is required").max(50, "Platform must be less than 50 characters").optional(),
});

const platforms = ["Amazon", "Flipkart", "Myntra", "Meesho", "Other"];

export default function ScanLog() {
  const [activeMode, setActiveMode] = useState<"receive" | "pick" | "damage">("receive");
  const [loading, setLoading] = useState(false);

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

  const handleReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const validation = scanSchema.safeParse({
        barcode: receiveData.barcode,
        quantity: parseInt(receiveData.quantity),
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
        scan_mode: "receive",
        quantity: validation.data.quantity,
      });

      if (error) throw error;

      toast.success("Stock received successfully!");
      setReceiveData({ barcode: "", quantity: "" });
    } catch (error: any) {
      toast.error(error.message || "Failed to receive stock");
    } finally {
      setLoading(false);
    }
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
      toast.error(error.message || "Failed to pick order");
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
      toast.error(error.message || "Failed to record damage");
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
              <form onSubmit={handleReceive} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="receive-barcode">Product Barcode *</Label>
                  <Input
                    id="receive-barcode"
                    placeholder="Scan or enter barcode"
                    required
                    value={receiveData.barcode}
                    onChange={(e) =>
                      setReceiveData({ ...receiveData, barcode: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="receive-quantity">Quantity Received *</Label>
                  <Input
                    id="receive-quantity"
                    type="number"
                    min="1"
                    required
                    value={receiveData.quantity}
                    onChange={(e) =>
                      setReceiveData({ ...receiveData, quantity: e.target.value })
                    }
                  />
                </div>
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? "Processing..." : "Submit Receive"}
                </Button>
              </form>
            </CardContent>
          </Card>
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
