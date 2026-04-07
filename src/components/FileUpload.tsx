import { useCallback, useState } from 'react';
import { Upload, FileSpreadsheet, Loader2 } from 'lucide-react';
import { parseExcelFile } from '@/lib/parseExcel';
import type { ParsedLoan } from '@/lib/types';

interface Props {
  onDataLoaded: (loans: ParsedLoan[]) => void;
}

export default function FileUpload({ onDataLoaded }: Props) {
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const loans = parseExcelFile(buffer);
      if (loans.length === 0) throw new Error('No data found');
      onDataLoaded(loans);
    } catch (e: any) {
      setError(e.message || 'Failed to parse file');
    } finally {
      setLoading(false);
    }
  }, [onDataLoaded]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div
      onDrop={onDrop}
      onDragOver={e => e.preventDefault()}
      className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
    >
      <input type="file" accept=".xlsx,.xls,.csv" onChange={onSelect} className="hidden" id="file-upload" />
      <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-3">
        {loading ? (
          <Loader2 className="w-10 h-10 text-muted-foreground animate-spin" />
        ) : fileName ? (
          <FileSpreadsheet className="w-10 h-10 text-risk-green" />
        ) : (
          <Upload className="w-10 h-10 text-muted-foreground" />
        )}
        <div>
          {loading ? (
            <p className="text-sm text-muted-foreground">Parsing {fileName}...</p>
          ) : fileName && !error ? (
            <p className="text-sm text-risk-green font-medium">✓ {fileName} loaded</p>
          ) : (
            <>
              <p className="text-sm font-medium">Drop Excel file here or click to upload</p>
              <p className="text-xs text-muted-foreground mt-1">Encompass Neighborhood Watch export (.xlsx)</p>
            </>
          )}
          {error && <p className="text-sm text-risk-red mt-1">{error}</p>}
        </div>
      </label>
    </div>
  );
}
