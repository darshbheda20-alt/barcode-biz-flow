import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList, Printer, Package } from "lucide-react";

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
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Flipkart</CardTitle>
                    <CardDescription>Upload combined label + invoice PDFs</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Upload multiple Flipkart PDFs containing both labels and invoices.
                    </p>
                    {/* File upload component will go here */}
                  </CardContent>
                </Card>

                {/* Amazon Section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Amazon</CardTitle>
                    <CardDescription>Upload label and invoice PDFs</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Upload Amazon labels and invoices (separate or combined files).
                    </p>
                    {/* File upload component will go here */}
                  </CardContent>
                </Card>

                {/* Myntra Section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Myntra</CardTitle>
                    <CardDescription>Upload Myntra Picklist CSV</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Upload the picklist CSV exported from Myntra portal.
                    </p>
                    {/* File upload component will go here */}
                  </CardContent>
                </Card>
              </div>

              <div className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Generated Picklists</CardTitle>
                    <CardDescription>Grouped by Master SKU</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Picklists will appear here after processing uploaded files.
                    </p>
                    {/* Picklist table will go here */}
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="print" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Crop & Print Labels and Invoices</CardTitle>
              <CardDescription>
                Automatically crop and print documents via QZ Tray
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="grid gap-6 md:grid-cols-3">
                  {/* Amazon Printing */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Amazon</CardTitle>
                      <CardDescription>Print labels & invoices</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Labels → 4x6 Thermal | Invoices → A4
                      </p>
                      {/* Print controls will go here */}
                    </CardContent>
                  </Card>

                  {/* Flipkart Printing */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Flipkart</CardTitle>
                      <CardDescription>Crop & print combined PDFs</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Auto-split: Top half → Label | Bottom half → Invoice
                      </p>
                      {/* Print controls will go here */}
                    </CardContent>
                  </Card>

                  {/* Myntra Printing */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Myntra</CardTitle>
                      <CardDescription>Upload & print documents</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Upload labels and invoices per Master SKU, then print.
                      </p>
                      {/* Print controls will go here */}
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Printing Queue</CardTitle>
                    <CardDescription>Track printing status</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Printing queue and status will appear here.
                    </p>
                    {/* Printing queue will go here */}
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="packaging" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Order Packaging</CardTitle>
              <CardDescription>
                Scan and verify orders, deduct inventory, and mark as dispatched
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Ready for Packaging</CardTitle>
                    <CardDescription>
                      Orders with printed labels and invoices
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Scan tracking ID, product barcode, and verify Master SKU to complete packaging.
                    </p>
                    {/* Packaging interface will go here */}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Packaging Instructions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-sm space-y-1">
                      <p className="font-semibold">For each order:</p>
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                        <li>Scan <strong>Tracking ID / Packet ID</strong></li>
                        <li>Scan <strong>Tag ID</strong> (if applicable)</li>
                        <li>Scan <strong>Product Barcode</strong></li>
                        <li>Verify <strong>Master SKU</strong> matches the order</li>
                        <li>Confirm to deduct inventory and mark as dispatched</li>
                      </ol>
                      <p className="text-xs italic mt-2">
                        Note: If barcode matches multiple Master SKUs, manual confirmation is required.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
