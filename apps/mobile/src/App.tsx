import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@shadcn/ui/components/card.tsx";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@shadcn/ui/components/field.tsx";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@shadcn/ui/components/input-otp.tsx";
import { Button } from "@shadcn/ui/components/button.tsx";

function App() {
  return (
    <>
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-xs">
          <Card>
            <CardHeader>
              <CardTitle>Enter verification code</CardTitle>
              <CardDescription>
                We sent a 6-digit code to your email.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="otp">Verification code</FieldLabel>
                    <InputOTP maxLength={6} id="otp" required>
                      <InputOTPGroup className="gap-2.5 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border">
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                    <FieldDescription>
                      Enter the 6-digit code sent to your email.
                    </FieldDescription>
                  </Field>
                  <FieldGroup>
                    <Button type="submit">Verify</Button>
                    <FieldDescription className="text-center">
                      Didn&apos;t receive the code? <a href="#">Resend</a>
                    </FieldDescription>
                  </FieldGroup>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

export default App;
