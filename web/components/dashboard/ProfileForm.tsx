'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError, type MeResponse } from '@/lib/api';

const DISPLAY_NAME_MAX = 40;
const BIO_MAX = 120;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ['image/png', 'image/jpeg'];

interface Props {
  username: string;
  me: MeResponse | null;
  onSaved: (fields: { displayName: string | null; bio: string | null }) => void;
}

export function ProfileForm({ username, me, onSaved }: Props) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // /me can land after the tab opens.
  const savedName = me?.displayName ?? '';
  const savedBio = me?.bio ?? '';
  useEffect(() => {
    setDisplayName(savedName);
    setBio(savedBio);
  }, [savedName, savedBio]);

  const dirty = displayName.trim() !== savedName || bio.trim() !== savedBio;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const result = await api.updateProfile({
        displayName: displayName.trim() || null,
        bio: bio.trim() || null,
      });
      onSaved({ displayName: result.displayName, bio: result.bio });
      toast('Profile saved');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const onPickPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) return toast('Use a PNG or JPG image');
    if (file.size > AVATAR_MAX_BYTES) return toast('That photo is over 2 MB');
    try {
      await api.uploadAvatar(file);
      toast('Photo updated');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Couldn’t upload the photo');
    }
  };

  return (
    <div className="max-w-[640px]">
      <Card className="grid content-start gap-[18px]">
        <div>
          <div className="text-[13px] font-semibold text-accent">Profile</div>
          <h2 className="mt-1.5 font-display text-[26px] font-semibold tracking-display-md">How your page reads</h2>
        </div>

        <div className="flex flex-wrap items-center gap-3.5">
          <span
            aria-hidden
            className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent font-display text-2xl font-bold text-on-accent"
          >
            {username.charAt(0)}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size={40} onClick={() => fileInput.current?.click()}>
              Upload photo
            </Button>
            <span className="text-xs text-ink3">PNG or JPG, square, under 2 MB</span>
            <input
              ref={fileInput}
              type="file"
              accept={AVATAR_TYPES.join(',')}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => void onPickPhoto(e)}
            />
          </div>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="grid gap-3">
          <Field
            shape="inset"
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={DISPLAY_NAME_MAX}
            placeholder="Your name"
            autoComplete="name"
            className="font-semibold"
          />
          <Field
            shape="inset"
            label={
              <>
                Bio{' '}
                <span className="font-medium normal-case tracking-normal">
                  · {bio.length}/{BIO_MAX}
                </span>
              </>
            }
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={BIO_MAX}
            placeholder="What are people paying you for?"
          />
          {error && (
            <Notice tone="danger" size="sm" role="alert">
              {error}
            </Notice>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="solid" loading={saving} loadingLabel="Saving…" disabled={!dirty}>
              Save profile
            </Button>
            <Link
              href={`/${username}`}
              className="inline-flex min-h-10 items-center text-sm font-semibold text-ink2 transition-colors hover:text-accent"
            >
              Preview public page →
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
