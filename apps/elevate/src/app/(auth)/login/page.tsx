import type { Metadata } from "next";
import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata: Metadata = { title: "Sign in" };

// Shell only. Phase 0.2 wires Supabase Auth, Google OAuth and mandatory TOTP MFA.
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Image src="/elite-logo-icon.png" alt="Elite Resource Services" width={72} height={72} priority />
          <CardTitle className="mt-2 text-xl">Sign in to ELEVATE</CardTitle>
          <CardDescription>Use your ERS account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" disabled />
            </div>
            <Button type="submit" className="w-full" disabled>
              Sign in
            </Button>
            <p className="text-center text-xs text-muted-foreground">Sign-in is switched on in the next build step.</p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
