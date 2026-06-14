# SMS API Documentation — EgoSMS via Pahappa CommsSDK

This document describes the SMS API used in the MUBS Alumni Database system. The same API can be integrated into other systems for sending SMS notifications.

---

## Overview

**Provider:** EgoSMS (https://comms.egosms.co)  
**SDK:** Pahappa CommsSDK v1 (PHP wrapper)  
**Package:** `pahappa-limited/comms-sdk`  
**API Base URL:** `https://comms.egosms.co/api/v1/json/`  
**Sandbox URL:** `https://comms-test.pahappa.net/api/v1/json` (for testing)

---

## Configuration

### Environment Variables

Add these to your `.env` file:

```env
EGOSMS_USERNAME=your_username
EGOSMS_PASSWORD=your_api_key
EGOSMS_SENDER_ID=MUBS
```

- **EGOSMS_USERNAME**: Your EgoSMS account username
- **EGOSMS_PASSWORD**: Your EgoSMS API key (not your login password)
- **EGOSMS_SENDER_ID**: The sender name shown on SMS (alphanumeric, max 11 chars)

### Laravel Configuration

Add to `config/services.php`:

```php
'egosms' => [
    'username'  => env('EGOSMS_USERNAME'),
    'password'  => env('EGOSMS_PASSWORD'),
    'sender_id' => env('EGOSMS_SENDER_ID', 'MUBS'),
],
```

---

## Installation

### Option 1: Using Composer (Recommended)

```bash
composer require pahappa/comms-sdk
```

### Option 2: Manual Installation

Add to your `composer.json`:

```json
{
  "require": {
    "pahappa-limited/comms-sdk": "@dev"
  }
}
```

Then run:

```bash
composer update
```

---

## Implementation

### Laravel Service Class

Create `app/Services/SmsService.php`:

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;
use PahappaLimited\CommsSDK\v1\CommsSDK;

class SmsService
{
    protected CommsSDK $sdk;

    public function __construct()
    {
        $this->sdk = CommsSDK::authenticate(
            config('services.egosms.username'),
            config('services.egosms.password'),
        );
    }

    /**
     * Send an SMS to one or more numbers.
     *
     * @param  string|array  $numbers  Any format — 07xx, 256xx, +256xx
     * @param  string        $message
     * @return bool
     */
    public function send(string|array $numbers, string $message): bool
    {
        $numbers  = array_map([$this, 'normalise'], (array) $numbers);
        $senderId = config('services.egosms.sender_id', 'MUBS');

        try {
            ob_start(); // Prevent SDK from echoing output
            $result = count($numbers) === 1
                ? $this->sdk->sendSMS($numbers[0], $message, $senderId)
                : $this->sdk->sendSMS($numbers, $message, $senderId);
            ob_end_clean();

            Log::info('EgoSMS sent', ['numbers' => $numbers, 'result' => $result]);
            return (bool) $result;

        } catch (\Throwable $e) {
            ob_end_clean();
            Log::error('EgoSMS send failed: ' . $e->getMessage());
            return false;
        }
    }

    /** Normalise phone numbers to Uganda E.164 format without '+' */
    protected function normalise(string $number): string
    {
        $number = preg_replace('/\D/', '', $number);

        // 07xxxxxxxx → 2567xxxxxxxx
        if (strlen($number) === 10 && str_starts_with($number, '0')) {
            $number = '256' . substr($number, 1);
        }

        return $number;
    }
}
```

### Usage Example

```php
// Send to single number
app(\App\Services\SmsService::class)->send(
    '0712345678',
    'Your OTP is 1234. Valid for 30 minutes.'
);

// Send to multiple numbers
app(\App\Services\SmsService::class)->send(
    ['0712345678', '0787654321'],
    'Meeting starts at 10 AM tomorrow.'
);

// In a controller
$smsService = new \App\Services\SmsService();
$sent = $smsService->send($userPhone, "Welcome to MUBS Alumni!");
if ($sent) {
    return back()->with('success', 'SMS sent successfully.');
}
```

---

## Direct SDK Usage (Without Wrapper)

### Basic Authentication

```php
use PahappaLimited\CommsSDK\v1\CommsSDK;

$sdk = CommsSDK::authenticate('your_username', 'your_api_key');
```

### Sending SMS

```php
// Single recipient
$success = $sdk->sendSMS('256712345678', 'Hello from PHP!');

// Multiple recipients
$success = $sdk->sendSMS(
    ['256712345678', '256787654321'],
    'Hello to all!'
);

// With custom sender ID and priority
use PahappaLimited\CommsSDK\v1\models\MessagePriority;

$success = $sdk->sendSMS(
    ['256712345678'],
    'Urgent: Your ballot OTP is 5678',
    'Elections',
    MessagePriority::HIGHEST
);

// Get full API response (for debugging)
$response = $sdk->querySendSMS(
    ['256712345678'],
    'Test message',
    'MUBS',
    MessagePriority::HIGH
);

echo "Status: {$response->status}\n";
echo "Cost: {$response->cost} {$response->currency}\n";
echo "Tracking Code: {$response->msgFollowUpUniqueCode}\n";
```

### Checking Balance

```php
// Simple balance check
$balance = $sdk->getBalance();
echo "Balance: UGX $balance\n";

// Detailed balance response
$response = $sdk->queryBalance();
echo "Status: {$response->status}\n";
echo "Balance: {$response->balance}\n";
echo "Currency: {$response->currency}\n";
```

### Using Sandbox (Testing)

```php
// Switch to sandbox environment
CommsSDK::useSandBox();

$sdk = CommsSDK::authenticate('test_username', 'test_api_key');
$sdk->sendSMS('256712345678', 'Test message');

// Switch back to live (optional)
CommsSDK::useLiveServer();
```

---

## API Reference

### CommsSDK Class

#### Static Methods

| Method                                       | Description                               |
| -------------------------------------------- | ----------------------------------------- |
| `CommsSDK::authenticate($username, $apiKey)` | Authenticate and return SDK instance      |
| `CommsSDK::useSandBox()`                     | Switch to sandbox environment for testing |
| `CommsSDK::useLiveServer()`                  | Switch to live environment (default)      |

#### Instance Methods

| Method                                                                                | Return Type   | Description                              |
| ------------------------------------------------------------------------------------- | ------------- | ---------------------------------------- |
| `sendSMS($numbers, $message, $senderId = null, $priority = MessagePriority::HIGHEST)` | `bool`        | Send SMS, returns true on success        |
| `querySendSMS($numbers, $message, $senderId, $priority)`                              | `ApiResponse` | Send SMS, returns full API response      |
| `getBalance()`                                                                        | `float`       | Get account balance as float             |
| `queryBalance()`                                                                      | `ApiResponse` | Get full balance response                |
| `withSenderId($senderId)`                                                             | `CommsSDK`    | Set sender ID, returns self for chaining |
| `isAuthenticated()`                                                                   | `bool`        | Check if SDK is authenticated            |

### MessagePriority Constants

| Priority                   | Value | Use Case               |
| -------------------------- | ----- | ---------------------- |
| `MessagePriority::HIGHEST` | "0"   | OTPs, critical alerts  |
| `MessagePriority::HIGH`    | "1"   | Urgent notifications   |
| `MessagePriority::MEDIUM`  | "2"   | Standard notifications |
| `MessagePriority::LOW`     | "3"   | Marketing, reminders   |
| `MessagePriority::LOWEST`  | "4"   | Bulk marketing         |

### ApiResponse Object

```php
$response->status;                  // "OK" or "Failed"
$response->message;                 // Response message
$response->cost;                    // Message cost (numeric)
$response->currency;                // Currency code (e.g., "UGX")
$response->msgFollowUpUniqueCode;   // Unique tracking code
$response->balance;                 // Remaining account balance
```

---

## Phone Number Formatting

The service normalizes phone numbers to Uganda E.164 format:

| Input Format    | Normalized Output | Notes                |
| --------------- | ----------------- | -------------------- |
| `0712345678`    | `256712345678`    | Local format         |
| `+256712345678` | `256712345678`    | International format |
| `256712345678`  | `256712345678`    | Already normalized   |
| `0712 345 678`  | `256712345678`    | Spaces removed       |

**Important:** All numbers are converted to Uganda format (`256` prefix). For other countries, modify the `normalise()` method in the `SmsService` class.

---

## Error Handling

### Common Errors

1. **Authentication Failed**
   - Check `EGOSMS_USERNAME` and `EGOSMS_PASSWORD` in `.env`
   - Verify credentials at https://comms.egosms.co

2. **Insufficient Balance**
   - Check balance: `$sdk->getBalance()`
   - Top up at https://comms.egosms.co

3. **Invalid Phone Number**
   - Ensure numbers are in correct format (07xxxxxxxx or 2567xxxxxxxx)
   - Verify numbers are active Ugandan mobile numbers

4. **Sender ID Rejected**
   - Use approved sender IDs only
   - Alphanumeric sender IDs: max 11 characters
   - Numeric sender IDs: not recommended

### Exception Handling

```php
use InvalidArgumentException;

try {
    $sdk = CommsSDK::authenticate('', ''); // Empty credentials
} catch (InvalidArgumentException $e) {
    Log::error('SMS authentication error: ' . $e->getMessage());
}

try {
    $sdk->sendSMS([], ''); // Empty numbers
} catch (InvalidArgumentException $e) {
    Log::error('SMS validation error: ' . $e->getMessage());
}
```

---

## Cost & Billing

- **SMS Cost**: ~UGX 40–80 per message (varies by volume)
- **Billing**: Prepaid via EgoSMS account
- **Check Balance**: `$sdk->getBalance()`
- **Top Up**: https://comms.egosms.co (supports Mobile Money, Visa, Mastercard)

---

## Real-World Examples from MUBS Alumni System

### 1. Ballot OTP (VotingController)

```php
// Send OTP for voting ballot access
$otp = rand(1000, 9999);
$phone = $request->phone;

app(\App\Services\SmsService::class)->send(
    $phone,
    "MUBS Alumni Elections: Your ballot OTP is {$otp}. Valid for 30 minutes. Do not share this code."
);
```

### 2. Bulk Notification (Example)

```php
// Notify all members about upcoming election
$members = Alumni::whereNotNull('mobile_phone')->pluck('mobile_phone')->toArray();

$smsService = app(\App\Services\SmsService::class);
$smsService->send(
    $members,
    "MUBS Alumni Election 2026: Voting opens tomorrow at 8 AM. Check your email for ballot access link."
);
```

### 3. Personalized Message (Example)

```php
// Send payment confirmation
foreach ($payments as $payment) {
    $message = "Dear {$payment->alumni->first_name}, your UGX {$payment->amount} payment has been received. Ref: {$payment->transaction_id}. Thank you!";

    app(\App\Services\SmsService::class)->send(
        $payment->alumni->mobile_phone,
        $message
    );
}
```

---

## Testing

### Sandbox Mode

```php
// Use sandbox for testing (no charges)
CommsSDK::useSandBox();

$sdk = CommsSDK::authenticate('test_username', 'test_key');
$sdk->sendSMS('256712345678', 'Test message — this won't be delivered');

// Check logs for response
Log::info('Sandbox SMS result');
```

### Local Testing (Skip SMS)

Add to `.env` for local development:

```env
SMS_ENABLED=false
```

Update `SmsService`:

```php
public function send(string|array $numbers, string $message): bool
{
    if (!config('services.sms_enabled', true)) {
        Log::info('SMS skipped (disabled)', ['numbers' => $numbers, 'message' => $message]);
        return true;
    }

    // ... existing code
}
```

---

## Troubleshooting

### Issue: SMS not sending

**Check:**

1. Credentials correct in `.env`
2. Account has sufficient balance
3. Phone numbers are valid Ugandan numbers
4. Sender ID is approved
5. Check Laravel logs: `storage/logs/laravel.log`

### Issue: SDK echoing output to response

**Solution:** Wrap SDK calls with output buffering:

```php
ob_start();
$result = $sdk->sendSMS($phone, $message);
ob_end_clean();
```

### Issue: "Invalid argument" exception

**Solution:** Ensure all required parameters are non-empty strings/arrays.

---

## Support & Resources

- **EgoSMS Website**: https://comms.egosms.co
- **Sandbox Account**: https://comms-test.pahappa.net
- **SDK GitHub**: https://github.com/pahappa/comms-sdk-php
- **Support Email**: support@egosms.co

---

## Summary

This SMS integration uses the **EgoSMS API** via the **Pahappa CommsSDK** PHP wrapper. The implementation includes:

✅ Simple Laravel service class  
✅ Automatic phone number normalization  
✅ Support for single and bulk SMS  
✅ Error handling and logging  
✅ Balance checking  
✅ Sandbox mode for testing

Copy the `SmsService` class and configuration to any Laravel project to use the same SMS API.
