import React from 'react';

export interface LogoItem {
  id: string;
  name: string;
  category: 'Spreadsheets' | 'Documents' | 'Code & Data' | 'System & Folders';
  source: 'Microsoft Fluent 365' | 'VS Code Material' | 'Adobe Official' | 'Official Language' | 'Modern Minimal';
  component: (props: { size?: number; className?: string }) => React.ReactElement;
  description: string;
}
