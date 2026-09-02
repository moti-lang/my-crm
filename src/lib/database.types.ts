// נוצר אוטומטית ע"י scripts/gen-types.mjs — אל תערוך ידנית.
// לרענון: npm run gen:types:local (מקומי) או npm run gen:types (מול Supabase).

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      attendance: {
        Row: {
          lesson_id: string;
          student_id: string;
          mark: Database["public"]["Enums"]["attendance_mark"];
          marked_at: string;
        };
        Insert: {
          lesson_id: string;
          student_id: string;
          mark: Database["public"]["Enums"]["attendance_mark"];
          marked_at?: string;
        };
        Update: {
          lesson_id?: string;
          student_id?: string;
          mark?: Database["public"]["Enums"]["attendance_mark"];
          marked_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_lesson_id_fkey";
            columns: ["lesson_id"];
            isOneToOne: false;
            referencedRelation: "lessons";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      attendance_links: {
        Row: {
          id: string;
          branch_id: string;
          token: string;
          is_active: boolean;
          last_used_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          branch_id: string;
          token: string;
          is_active?: boolean;
          last_used_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          branch_id?: string;
          token?: string;
          is_active?: boolean;
          last_used_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_links_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          id: string;
          actor: string;
          action: string;
          table_name: string;
          row_id: string | null;
          before: Json | null;
          after: Json | null;
          source: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor: string;
          action: string;
          table_name: string;
          row_id?: string | null;
          before?: Json | null;
          after?: Json | null;
          source?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor?: string;
          action?: string;
          table_name?: string;
          row_id?: string | null;
          before?: Json | null;
          after?: Json | null;
          source?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      authorized_numbers: {
        Row: {
          id: string;
          phone: string;
          label: string;
          scope: string;
          branch_id: string | null;
          can_delete: boolean;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          phone: string;
          label: string;
          scope?: string;
          branch_id?: string | null;
          can_delete?: boolean;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          phone?: string;
          label?: string;
          scope?: string;
          branch_id?: string | null;
          can_delete?: boolean;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "authorized_numbers_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      branch_staff: {
        Row: {
          branch_id: string;
          user_id: string;
        };
        Insert: {
          branch_id: string;
          user_id: string;
        };
        Update: {
          branch_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branch_staff_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "branch_staff_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      branches: {
        Row: {
          id: string;
          name: string;
          city: string | null;
          address: string | null;
          supervisor_name: string | null;
          supervisor_phone: string | null;
          schedule_text: string | null;
          weekdays: number[];
          lesson_time: string | null;
          default_tuition: number;
          monthly_rent: number | null;
          is_active: boolean;
          deleted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          city?: string | null;
          address?: string | null;
          supervisor_name?: string | null;
          supervisor_phone?: string | null;
          schedule_text?: string | null;
          weekdays?: number[];
          lesson_time?: string | null;
          default_tuition?: number;
          monthly_rent?: number | null;
          is_active?: boolean;
          deleted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          city?: string | null;
          address?: string | null;
          supervisor_name?: string | null;
          supervisor_phone?: string | null;
          schedule_text?: string | null;
          weekdays?: number[];
          lesson_time?: string | null;
          default_tuition?: number;
          monthly_rent?: number | null;
          is_active?: boolean;
          deleted_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          scope: Database["public"]["Enums"]["entry_scope"];
          kind: Database["public"]["Enums"]["entry_kind"];
          name: string;
          sort_order: number;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          scope: Database["public"]["Enums"]["entry_scope"];
          kind: Database["public"]["Enums"]["entry_kind"];
          name: string;
          sort_order?: number;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          scope?: Database["public"]["Enums"]["entry_scope"];
          kind?: Database["public"]["Enums"]["entry_kind"];
          name?: string;
          sort_order?: number;
          is_active?: boolean;
        };
        Relationships: [];
      };
      commands: {
        Row: {
          id: string;
          phone: string;
          raw_text: string;
          parsed: Json | null;
          intent: string | null;
          status: Database["public"]["Enums"]["command_status"];
          result_table: string | null;
          result_id: string | null;
          error: string | null;
          confirmed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          phone: string;
          raw_text: string;
          parsed?: Json | null;
          intent?: string | null;
          status?: Database["public"]["Enums"]["command_status"];
          result_table?: string | null;
          result_id?: string | null;
          error?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          phone?: string;
          raw_text?: string;
          parsed?: Json | null;
          intent?: string | null;
          status?: Database["public"]["Enums"]["command_status"];
          result_table?: string | null;
          result_id?: string | null;
          error?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          phone: string;
          contact_name: string | null;
          student_id: string | null;
          is_human_takeover: boolean;
          last_message_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          phone: string;
          contact_name?: string | null;
          student_id?: string | null;
          is_human_takeover?: boolean;
          last_message_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          phone?: string;
          contact_name?: string | null;
          student_id?: string | null;
          is_human_takeover?: boolean;
          last_message_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      faq_entries: {
        Row: {
          id: string;
          question: string;
          answer: string;
          keywords: string[];
          is_active: boolean;
          hits: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          question: string;
          answer: string;
          keywords?: string[];
          is_active?: boolean;
          hits?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          question?: string;
          answer?: string;
          keywords?: string[];
          is_active?: boolean;
          hits?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      holidays: {
        Row: {
          day: string;
          name: string;
        };
        Insert: {
          day: string;
          name: string;
        };
        Update: {
          day?: string;
          name?: string;
        };
        Relationships: [];
      };
      ledger_entries: {
        Row: {
          id: string;
          season_id: string;
          kind: Database["public"]["Enums"]["entry_kind"];
          scope: Database["public"]["Enums"]["entry_scope"];
          branch_id: string | null;
          production_id: string | null;
          entry_date: string;
          category: string;
          vendor: string | null;
          description: string | null;
          amount: number;
          method: Database["public"]["Enums"]["payment_method"] | null;
          receipt_url: string | null;
          is_recurring: boolean;
          recurring_day: number | null;
          recurring_until: string | null;
          split_method: Database["public"]["Enums"]["split_method"];
          split_manual: Json | null;
          created_by: string | null;
          source: string | null;
          deleted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          season_id: string;
          kind: Database["public"]["Enums"]["entry_kind"];
          scope: Database["public"]["Enums"]["entry_scope"];
          branch_id?: string | null;
          production_id?: string | null;
          entry_date?: string;
          category: string;
          vendor?: string | null;
          description?: string | null;
          amount: number;
          method?: Database["public"]["Enums"]["payment_method"] | null;
          receipt_url?: string | null;
          is_recurring?: boolean;
          recurring_day?: number | null;
          recurring_until?: string | null;
          split_method?: Database["public"]["Enums"]["split_method"];
          split_manual?: Json | null;
          created_by?: string | null;
          source?: string | null;
          deleted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          season_id?: string;
          kind?: Database["public"]["Enums"]["entry_kind"];
          scope?: Database["public"]["Enums"]["entry_scope"];
          branch_id?: string | null;
          production_id?: string | null;
          entry_date?: string;
          category?: string;
          vendor?: string | null;
          description?: string | null;
          amount?: number;
          method?: Database["public"]["Enums"]["payment_method"] | null;
          receipt_url?: string | null;
          is_recurring?: boolean;
          recurring_day?: number | null;
          recurring_until?: string | null;
          split_method?: Database["public"]["Enums"]["split_method"];
          split_manual?: Json | null;
          created_by?: string | null;
          source?: string | null;
          deleted_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_entries_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_entries_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_entries_production_id_fkey";
            columns: ["production_id"];
            isOneToOne: false;
            referencedRelation: "productions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_entries_season_id_fkey";
            columns: ["season_id"];
            isOneToOne: false;
            referencedRelation: "seasons";
            referencedColumns: ["id"];
          },
        ];
      };
      lessons: {
        Row: {
          id: string;
          branch_id: string;
          lesson_date: string;
          status: Database["public"]["Enums"]["lesson_status"];
          reported_at: string | null;
          reported_by: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          branch_id: string;
          lesson_date: string;
          status?: Database["public"]["Enums"]["lesson_status"];
          reported_at?: string | null;
          reported_by?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          branch_id?: string;
          lesson_date?: string;
          status?: Database["public"]["Enums"]["lesson_status"];
          reported_at?: string | null;
          reported_by?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lessons_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      message_templates: {
        Row: {
          id: string;
          key: string;
          name: string;
          body: string;
          kind: Database["public"]["Enums"]["reminder_kind"];
          is_active: boolean;
        };
        Insert: {
          id?: string;
          key: string;
          name: string;
          body: string;
          kind: Database["public"]["Enums"]["reminder_kind"];
          is_active?: boolean;
        };
        Update: {
          id?: string;
          key?: string;
          name?: string;
          body?: string;
          kind?: Database["public"]["Enums"]["reminder_kind"];
          is_active?: boolean;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          student_id: string;
          paid_on: string;
          amount: number;
          method: Database["public"]["Enums"]["payment_method"];
          covers_note: string | null;
          receipt_no: string | null;
          receipt_url: string | null;
          collected_by: string | null;
          source: string | null;
          note: string | null;
          deleted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          paid_on?: string;
          amount: number;
          method?: Database["public"]["Enums"]["payment_method"];
          covers_note?: string | null;
          receipt_no?: string | null;
          receipt_url?: string | null;
          collected_by?: string | null;
          source?: string | null;
          note?: string | null;
          deleted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          paid_on?: string;
          amount?: number;
          method?: Database["public"]["Enums"]["payment_method"];
          covers_note?: string | null;
          receipt_no?: string | null;
          receipt_url?: string | null;
          collected_by?: string | null;
          source?: string | null;
          note?: string | null;
          deleted_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_collected_by_fkey";
            columns: ["collected_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      production_cast: {
        Row: {
          production_id: string;
          student_id: string;
          role_name: string | null;
        };
        Insert: {
          production_id: string;
          student_id: string;
          role_name?: string | null;
        };
        Update: {
          production_id?: string;
          student_id?: string;
          role_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "production_cast_production_id_fkey";
            columns: ["production_id"];
            isOneToOne: false;
            referencedRelation: "productions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_cast_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      productions: {
        Row: {
          id: string;
          name: string;
          year: string | null;
          status: Database["public"]["Enums"]["production_status"];
          budget: number | null;
          release_date: string | null;
          notes: string | null;
          deleted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          year?: string | null;
          status?: Database["public"]["Enums"]["production_status"];
          budget?: number | null;
          release_date?: string | null;
          notes?: string | null;
          deleted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          year?: string | null;
          status?: Database["public"]["Enums"]["production_status"];
          budget?: number | null;
          release_date?: string | null;
          notes?: string | null;
          deleted_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string;
          phone: string | null;
          role: Database["public"]["Enums"]["user_role"];
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      reminders: {
        Row: {
          id: string;
          kind: Database["public"]["Enums"]["reminder_kind"];
          student_id: string | null;
          branch_id: string | null;
          to_phone: string;
          to_label: string | null;
          body: string;
          scheduled_at: string;
          sent_at: string | null;
          status: Database["public"]["Enums"]["reminder_status"];
          error: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          kind: Database["public"]["Enums"]["reminder_kind"];
          student_id?: string | null;
          branch_id?: string | null;
          to_phone: string;
          to_label?: string | null;
          body: string;
          scheduled_at: string;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["reminder_status"];
          error?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          kind?: Database["public"]["Enums"]["reminder_kind"];
          student_id?: string | null;
          branch_id?: string | null;
          to_phone?: string;
          to_label?: string | null;
          body?: string;
          scheduled_at?: string;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["reminder_status"];
          error?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reminders_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reminders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reminders_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      seasons: {
        Row: {
          id: string;
          name: string;
          starts_on: string;
          ends_on: string;
          is_current: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          starts_on: string;
          ends_on: string;
          is_current?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          starts_on?: string;
          ends_on?: string;
          is_current?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          key: string;
          value: Json;
        };
        Insert: {
          key: string;
          value: Json;
        };
        Update: {
          key?: string;
          value?: Json;
        };
        Relationships: [];
      };
      students: {
        Row: {
          id: string;
          season_id: string;
          branch_id: string;
          full_name: string;
          birth_date: string | null;
          grade: string | null;
          group_name: string | null;
          parent_name: string | null;
          parent_phone: string | null;
          alt_phone: string | null;
          address: string | null;
          email: string | null;
          status: Database["public"]["Enums"]["student_status"];
          joined_on: string | null;
          stopped_on: string | null;
          stop_reason: string | null;
          tuition_total: number;
          discount: number;
          discount_reason: string | null;
          installments: number | null;
          photo_consent: boolean;
          notes: string | null;
          source: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          season_id: string;
          branch_id: string;
          full_name: string;
          birth_date?: string | null;
          grade?: string | null;
          group_name?: string | null;
          parent_name?: string | null;
          parent_phone?: string | null;
          alt_phone?: string | null;
          address?: string | null;
          email?: string | null;
          status?: Database["public"]["Enums"]["student_status"];
          joined_on?: string | null;
          stopped_on?: string | null;
          stop_reason?: string | null;
          tuition_total?: number;
          discount?: number;
          discount_reason?: string | null;
          installments?: number | null;
          photo_consent?: boolean;
          notes?: string | null;
          source?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          season_id?: string;
          branch_id?: string;
          full_name?: string;
          birth_date?: string | null;
          grade?: string | null;
          group_name?: string | null;
          parent_name?: string | null;
          parent_phone?: string | null;
          alt_phone?: string | null;
          address?: string | null;
          email?: string | null;
          status?: Database["public"]["Enums"]["student_status"];
          joined_on?: string | null;
          stopped_on?: string | null;
          stop_reason?: string | null;
          tuition_total?: number;
          discount?: number;
          discount_reason?: string | null;
          installments?: number | null;
          photo_consent?: boolean;
          notes?: string | null;
          source?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "students_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "students_season_id_fkey";
            columns: ["season_id"];
            isOneToOne: false;
            referencedRelation: "seasons";
            referencedColumns: ["id"];
          },
        ];
      };
      unanswered_questions: {
        Row: {
          id: string;
          phone: string | null;
          question: string;
          resolved: boolean;
          faq_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          phone?: string | null;
          question: string;
          resolved?: boolean;
          faq_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          phone?: string | null;
          question?: string;
          resolved?: boolean;
          faq_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "unanswered_questions_faq_id_fkey";
            columns: ["faq_id"];
            isOneToOne: false;
            referencedRelation: "faq_entries";
            referencedColumns: ["id"];
          },
        ];
      };
      wa_messages: {
        Row: {
          id: string;
          direction: Database["public"]["Enums"]["msg_direction"];
          phone: string;
          body: string | null;
          status: Database["public"]["Enums"]["msg_status"] | null;
          green_id: string | null;
          reminder_id: string | null;
          meta: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          direction: Database["public"]["Enums"]["msg_direction"];
          phone: string;
          body?: string | null;
          status?: Database["public"]["Enums"]["msg_status"] | null;
          green_id?: string | null;
          reminder_id?: string | null;
          meta?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          direction?: Database["public"]["Enums"]["msg_direction"];
          phone?: string;
          body?: string | null;
          status?: Database["public"]["Enums"]["msg_status"] | null;
          green_id?: string | null;
          reminder_id?: string | null;
          meta?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wa_messages_reminder_id_fkey";
            columns: ["reminder_id"];
            isOneToOne: false;
            referencedRelation: "reminders";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      v_branch_pnl: {
        Row: {
          branch_id: string | null;
          name: string | null;
          income_students: number | null;
          income_other: number | null;
          expenses: number | null;
          open_debt: number | null;
          active_students: number | null;
        };
        Relationships: [];
      };
      v_student_balance: {
        Row: {
          student_id: string | null;
          branch_id: string | null;
          season_id: string | null;
          full_name: string | null;
          due: number | null;
          paid: number | null;
          balance: number | null;
          last_paid_on: string | null;
        };
        Relationships: [];
      };
      v_student_overview: {
        Row: {
          id: string | null;
          season_id: string | null;
          branch_id: string | null;
          branch_name: string | null;
          full_name: string | null;
          grade: string | null;
          group_name: string | null;
          parent_name: string | null;
          parent_phone: string | null;
          status: Database["public"]["Enums"]["student_status"] | null;
          joined_on: string | null;
          stopped_on: string | null;
          stop_reason: string | null;
          tuition_total: number | null;
          discount: number | null;
          discount_reason: string | null;
          installments: number | null;
          photo_consent: boolean | null;
          notes: string | null;
          due: number | null;
          paid: number | null;
          balance: number | null;
          last_paid_on: string | null;
          lessons_attended: number | null;
          lessons_total: number | null;
          attendance_pct: number | null;
        };
        Relationships: [];
      };
      v_students_accounting: {
        Row: {
          id: string | null;
          season_id: string | null;
          branch_id: string | null;
          full_name: string | null;
          grade: string | null;
          group_name: string | null;
          status: Database["public"]["Enums"]["student_status"] | null;
          joined_on: string | null;
          stopped_on: string | null;
          tuition_total: number | null;
          discount: number | null;
          installments: number | null;
        };
        Relationships: [];
      };
    };
    Enums: {
      attendance_mark: "present" | "late" | "absent" | "excused";
      command_status: "pending_confirm" | "applied" | "cancelled" | "rejected" | "failed";
      entry_kind: "income" | "expense";
      entry_scope: "branch" | "general" | "production";
      lesson_status: "pending" | "reported" | "cancelled";
      msg_direction: "in" | "out";
      msg_status: "queued" | "sent" | "delivered" | "read" | "failed";
      payment_method: "cash" | "transfer" | "bit" | "credit" | "check" | "other";
      production_status: "planning" | "rehearsals" | "filming" | "editing" | "released";
      reminder_kind: "debt" | "followup" | "general" | "attendance" | "owner_summary" | "event";
      reminder_status: "scheduled" | "sent" | "cancelled" | "failed";
      split_method: "none" | "equal" | "by_students" | "manual";
      student_status: "active" | "pending" | "stopped" | "graduated";
      user_role: "owner" | "branch_manager" | "accountant";
    };
    Functions: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type Views<T extends keyof Database["public"]["Views"]> = Database["public"]["Views"][T]["Row"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
