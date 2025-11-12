export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      printing_status: {
        Row: {
          created_at: string
          id: string
          invoice_file_path: string | null
          invoice_printed: boolean
          label_file_path: string | null
          label_printed: boolean
          printed_at: string | null
          process_order_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_file_path?: string | null
          invoice_printed?: boolean
          label_file_path?: string | null
          label_printed?: boolean
          printed_at?: string | null
          process_order_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_file_path?: string | null
          invoice_printed?: boolean
          label_file_path?: string | null
          label_printed?: boolean
          printed_at?: string | null
          process_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "printing_status_process_order_id_fkey"
            columns: ["process_order_id"]
            isOneToOne: true
            referencedRelation: "process_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      process_orders: {
        Row: {
          amount: number | null
          created_at: string
          id: string
          invoice_date: string | null
          invoice_number: string | null
          marketplace_sku: string | null
          master_sku: string | null
          order_id: string
          packet_id: string | null
          payment_type: string | null
          platform: string
          product_id: string | null
          product_name: string | null
          quantity: number
          tag_id: string | null
          tracking_id: string | null
          updated_at: string
          uploaded_file_path: string | null
          workflow_status: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          marketplace_sku?: string | null
          master_sku?: string | null
          order_id: string
          packet_id?: string | null
          payment_type?: string | null
          platform: string
          product_id?: string | null
          product_name?: string | null
          quantity?: number
          tag_id?: string | null
          tracking_id?: string | null
          updated_at?: string
          uploaded_file_path?: string | null
          workflow_status?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          marketplace_sku?: string | null
          master_sku?: string | null
          order_id?: string
          packet_id?: string | null
          payment_type?: string | null
          platform?: string
          product_id?: string | null
          product_name?: string | null
          quantity?: number
          tag_id?: string | null
          tracking_id?: string | null
          updated_at?: string
          uploaded_file_path?: string | null
          workflow_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "process_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          available_units: number
          barcode: string | null
          brand: string
          brand_size: string | null
          color: string | null
          cost_price: number
          created_at: string
          damaged_units: number
          id: string
          master_sku: string
          mrp: number
          name: string
          reorder_level: number
          standard_size: string | null
          updated_at: string
          vendor_name: string
        }
        Insert: {
          available_units?: number
          barcode?: string | null
          brand: string
          brand_size?: string | null
          color?: string | null
          cost_price: number
          created_at?: string
          damaged_units?: number
          id?: string
          master_sku: string
          mrp: number
          name: string
          reorder_level?: number
          standard_size?: string | null
          updated_at?: string
          vendor_name: string
        }
        Update: {
          available_units?: number
          barcode?: string | null
          brand?: string
          brand_size?: string | null
          color?: string | null
          cost_price?: number
          created_at?: string
          damaged_units?: number
          id?: string
          master_sku?: string
          mrp?: number
          name?: string
          reorder_level?: number
          standard_size?: string | null
          updated_at?: string
          vendor_name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      sales_orders: {
        Row: {
          created_at: string
          id: string
          order_id: string
          packet_id: string | null
          platform: string
          product_id: string
          quantity: number
          tag_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          packet_id?: string | null
          platform: string
          product_id: string
          quantity: number
          tag_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          packet_id?: string | null
          platform?: string
          product_id?: string
          quantity?: number
          tag_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_logs: {
        Row: {
          created_at: string
          id: string
          order_id: string | null
          packet_id: string | null
          platform: string | null
          product_id: string
          quantity: number
          scan_mode: string
          tag_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          order_id?: string | null
          packet_id?: string | null
          platform?: string | null
          product_id: string
          quantity: number
          scan_mode: string
          tag_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string | null
          packet_id?: string | null
          platform?: string | null
          product_id?: string
          quantity?: number
          scan_mode?: string
          tag_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scan_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      sku_aliases: {
        Row: {
          alias_type: string
          alias_value: string
          created_at: string
          id: string
          marketplace: string
          marketplace_sku: string | null
          product_id: string
          updated_at: string
        }
        Insert: {
          alias_type: string
          alias_value: string
          created_at?: string
          id?: string
          marketplace: string
          marketplace_sku?: string | null
          product_id: string
          updated_at?: string
        }
        Update: {
          alias_type?: string
          alias_value?: string
          created_at?: string
          id?: string
          marketplace?: string
          marketplace_sku?: string | null
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sku_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
