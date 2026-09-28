/**
 * New Application flow (upload → review → send). The page owns the flow state
 * and job polling; each step lives in ./new-application/.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ImageOff, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Mono } from '@/components/Mono';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getJob, importJob, uploadJobScreenshot } from '@/lib/api';
import { isJobProcessing, type FlowStep } from '@/pages/newApplicationUtils';
import { EmailPreviewStep } from '@/pages/new-application/EmailPreviewStep';
import { ReviewStep } from '@/pages/new-application/ReviewStep';
import { UploadStep } from '@/pages/new-application/UploadStep';
import { StepsHeader } from '@/pages/new-application/shared';

/* ── Page ───────────────────────────────────────────────────────── */

export function NewApplication() {
  const [searchParams] = useSearchParams();
  const jobParam = searchParams.get('job');

  const [jobId, setJobId] = useState<string | null>(jobParam);
  const [step, setStep] = useState<FlowStep>(jobParam ? 2 : 1);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const announcedRef = useRef<string | null>(null);

  /* React to ?job= changes (duplicate-warning link, dashboard rows). */
  useEffect(() => {
    if (jobParam && jobParam !== jobId) {
      setJobId(jobParam);
      setStep(2);
      setLocalPreviewUrl(null);
      setManualEntry(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobParam]);

  const jobQuery = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => getJob(jobId as string),
    enabled: jobId !== null,
    refetchInterval: (query) => (isJobProcessing(query.state.data?.job.status) ? 1500 : false),
  });

  const job = jobQuery.data?.job ?? null;
  const processing = job !== null && isJobProcessing(job.status);

  /* Revoke the upload-preview object URL when it is replaced or on unmount. */
  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  /* Auto-advance once extraction finishes (edge case toasts included). */
  useEffect(() => {
    if (!job || step !== 1 || jobId === null) return;
    if (job.status === 'processing' || job.status === 'failed') return;
    const key = `${job.id}:${job.status}`;
    if (announcedRef.current !== key) {
      announcedRef.current = key;
      if (job.status === 'needs_review') {
        toast.warning('Extraction needs review — please verify the fields.');
      } else {
        toast.success('Extraction complete');
      }
    }
    setStep(2);
  }, [job, step, jobId]);

  const uploadMutation = useMutation({
    mutationFn: uploadJobScreenshot,
    onSuccess: (data, file) => {
      setLocalPreviewUrl(URL.createObjectURL(file));
      setJobId(data.jobPostId);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Upload failed — please try again.');
    },
  });

  /* Pasted-text import — same 202 → poll contract as the screenshot upload. */
  const importMutation = useMutation({
    mutationFn: importJob,
    onSuccess: (data) => {
      setJobId(data.jobPostId);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Import failed — please try again.');
    },
  });

  const handleReset = useCallback(() => {
    setJobId(null);
    setLocalPreviewUrl(null);
    setManualEntry(false);
    setStep(1);
    announcedRef.current = null;
  }, []);

  const handleManualEntry = useCallback(() => {
    setManualEntry(true);
    setStep(2);
  }, []);

  const stepContent = useMemo(() => {
    if ((step === 2 || step === 3) && jobId) {
      if (jobQuery.isPending) {
        return (
          <div className="space-y-4 rounded-card border border-graphite bg-ink-2 p-6">
            <Skeleton className="h-5 w-40 bg-ink-3" />
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-20 bg-ink-3" />
                  <Skeleton className="h-9 w-full bg-ink-3" />
                </div>
              ))}
            </div>
            <Skeleton className="h-12 w-full bg-ink-3" />
            <Skeleton className="h-12 w-full bg-ink-3" />
          </div>
        );
      }
      if (jobQuery.isError || !job) {
        return (
          <div className="rounded-card border border-danger/40 bg-ink-2 p-4">
            <div className="flex items-start gap-3">
              <ImageOff className="mt-0.5 size-5 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <Mono size="xs" color="danger">COULDN&apos;T LOAD THIS APPLICATION</Mono>
                <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
                  The application didn&apos;t come back from the server — try again.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => void jobQuery.refetch()}>
                    <RefreshCw className="size-4" />
                    Retry
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      }
      if (step === 3) {
        return (
          <EmailPreviewStep
            key={job.id}
            job={job}
            onBack={() => setStep(2)}
            onReset={handleReset}
          />
        );
      }
      return (
        <ReviewStep
          key={job.id}
          job={job}
          onContinue={() => setStep(3)}
          onReset={handleReset}
        />
      );
    }

    return (
      <UploadStep
        analyzing={
          uploadMutation.isPending ||
          importMutation.isPending ||
          (jobId !== null && (jobQuery.isPending || processing))
        }
        analyzingPreviewUrl={localPreviewUrl}
        failed={job?.status === 'failed'}
        failureMessage={job?.error ?? null}
        uploading={uploadMutation.isPending}
        importing={importMutation.isPending}
        onUpload={(file) => uploadMutation.mutate(file)}
        onImport={(input) => importMutation.mutate(input)}
        onReset={handleReset}
        onManualEntry={handleManualEntry}
      />
    );
  }, [
    step,
    jobId,
    job,
    jobQuery.isPending,
    jobQuery.isError,
    processing,
    localPreviewUrl,
    uploadMutation,
    importMutation,
    jobQuery.refetch,
    handleReset,
    handleManualEntry,
  ]);

  return (
    <div className="space-y-8 animate-fade-in-up">
      <StepsHeader current={step} />

      <AnimatePresence mode="wait">
        <motion.div
          key={`${manualEntry ? 'manual' : ''}${step}`}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          {stepContent}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}