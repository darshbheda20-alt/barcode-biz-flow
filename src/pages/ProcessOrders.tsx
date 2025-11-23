import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList, Printer, Package } from "lucide-react";
import { FlipkartUpload } from "@/components/process-orders/FlipkartUpload";
import { AmazonUpload } from "@/components/process-orders/AmazonUpload";
import { MyntraUpload } from "@/components/process-orders/MyntraUpload";
import { PicklistView } from "@/components/process-orders/PicklistView";
import { UnmappedSKUs } from "@/components/process-orders/UnmappedSKUs";
import { OrderPackingList } from "@/components/process-orders/OrderPackingList";
import { CropAndPrintQueue } from "@/components/process-orders/CropAndPrintQueue";

export default function ProcessOrders() {
  const [activeTab, setActiveTab] = useState("picklist");

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Process Orders</h1>
          <p className="text-muted-foreground">
            Upload, process, and manage orders from Flipkart, Amazon, and Myntra
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="picklist" className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            <span>Generate Picklist</span>
          </TabsTrigger>
          <TabsTrigger value="print" className="flex items-center gap-2">
            <Printer className="h-4 w-4" />
            <span>Crop & Print</span>
          </TabsTrigger>
          <TabsTrigger value="packaging" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            <span>Order Packaging</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="picklist" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Generate Picklist</CardTitle>
              <CardDescription>
                Upload marketplace files and generate picklists grouped by Master SKU
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-3">
                {/* Flipkart Section */}
                <FlipkartUpload onOrdersParsed={() => {}} />

                {/* Amazon Section */}
                <AmazonUpload onOrdersParsed={() => {}} />

                {/* Myntra Section */}
                <MyntraUpload onOrdersParsed={() => {}} />
              </div>

              <div className="mt-6 space-y-6">
                <UnmappedSKUs />
                <PicklistView />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="print" className="space-y-4">
          <CropAndPrintQueue />
          
          <Card>
            <CardHeader>
              <CardTitle>Platform-Specific Instructions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="border rounded p-4">
                  <h3 className="font-semibold mb-2">Flipkart</h3>
                  <p className="text-sm text-muted-foreground">
                    PDFs are automatically cropped into 4x6 labels and invoices
                  </p>
                </div>
                <div className="border rounded p-4">
                  <h3 className="font-semibold mb-2">Amazon</h3>
                  <p className="text-sm text-muted-foreground">
                    Original PDFs attached without cropping
                  </p>
                </div>
                <div className="border rounded p-4">
                  <h3 className="font-semibold mb-2">Myntra</h3>
                  <p className="text-sm text-muted-foreground">
                    Upload labels and invoices manually during packing
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="packaging" className="space-y-4">
          <OrderPackingList />
          
          <Card>
            <CardHeader>
              <CardTitle>Packaging Instructions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-sm space-y-1">
                <p className="font-semibold">For each order:</p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li>Click "Pack" on an order from the queue above</li>
                  <li>Scan <strong>Product Barcode</strong> using camera or manual input</li>
                  <li>If multiple products match, select the correct one</li>
                  <li>System automatically deducts inventory</li>
                  <li>Click "Complete Packing" to create Sales Order</li>
                </ol>
                <p className="text-xs italic mt-2 bg-blue-50 p-2 rounded">
                  <strong>Apply to next scans:</strong> When scanning ambiguous barcodes, you can choose to auto-apply your selection for the next 5 scans to speed up packing.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
