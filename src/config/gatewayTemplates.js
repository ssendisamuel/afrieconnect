const GATEWAY_TEMPLATES = {
  payment: [
    {
      provider: 'flutterwave',
      display_name: 'Flutterwave',
      description: 'Mobile Money, cards, bank transfers across Africa',
      supported: true,
      defaults: { api_base: 'https://f4bexperience.flutterwave.com' },
      fields: [
        { key: 'client_id', label: 'Client ID', type: 'text', required: true },
        { key: 'client_secret', label: 'Client Secret', type: 'password', required: true },
        { key: 'encryption_key', label: 'Encryption Key (cards)', type: 'password' },
        { key: 'api_base', label: 'API Base URL', type: 'text' },
        { key: 'webhook_secret', label: 'Webhook Secret (verif-hash)', type: 'password' }
      ]
    },
    {
      provider: 'paystack',
      display_name: 'Paystack',
      description: 'Cards, bank, USSD — Nigeria, Ghana, South Africa, Kenya',
      supported: false,
      defaults: { api_base: 'https://api.paystack.co' },
      fields: [
        { key: 'public_key', label: 'Public Key', type: 'text', required: true },
        { key: 'secret_key', label: 'Secret Key', type: 'password', required: true },
        { key: 'webhook_secret', label: 'Webhook Secret', type: 'password' }
      ]
    },
    {
      provider: 'stripe',
      display_name: 'Stripe',
      description: 'Global card payments and checkout',
      supported: false,
      defaults: { api_base: 'https://api.stripe.com' },
      fields: [
        { key: 'publishable_key', label: 'Publishable Key', type: 'text', required: true },
        { key: 'secret_key', label: 'Secret Key', type: 'password', required: true },
        { key: 'webhook_secret', label: 'Webhook Signing Secret', type: 'password' }
      ]
    },
    {
      provider: 'mpesa',
      display_name: 'M-Pesa (Safaricom Daraja)',
      description: 'Safaricom mobile money — Kenya & East Africa',
      supported: false,
      defaults: { environment: 'sandbox' },
      fields: [
        { key: 'consumer_key', label: 'Consumer Key', type: 'text', required: true },
        { key: 'consumer_secret', label: 'Consumer Secret', type: 'password', required: true },
        { key: 'shortcode', label: 'Business Shortcode', type: 'text', required: true },
        { key: 'passkey', label: 'Online Passkey', type: 'password', required: true },
        { key: 'environment', label: 'Environment (sandbox / production)', type: 'text' }
      ]
    },
    {
      provider: 'pesapal',
      display_name: 'Pesapal',
      description: 'Mobile money and cards — Uganda, Kenya, Tanzania',
      supported: false,
      defaults: { api_base: 'https://pay.pesapal.com/v3' },
      fields: [
        { key: 'consumer_key', label: 'Consumer Key', type: 'text', required: true },
        { key: 'consumer_secret', label: 'Consumer Secret', type: 'password', required: true },
        { key: 'ipn_id', label: 'IPN Notification ID', type: 'text' },
        { key: 'api_base', label: 'API Base URL', type: 'text' }
      ]
    },
    {
      provider: 'dpo',
      display_name: 'DPO Pay / PayGate',
      description: 'Cards and mobile money across Africa',
      supported: false,
      fields: [
        { key: 'company_token', label: 'Company Token', type: 'password', required: true },
        { key: 'service_type', label: 'Service Type ID', type: 'text', required: true },
        { key: 'api_base', label: 'API Base URL', type: 'text' }
      ]
    }
  ],
  sms: [
    {
      provider: 'egosms',
      display_name: 'Pahappa / EgoSMS',
      description: 'Uganda SMS via CommsSDK JSON API',
      supported: true,
      defaults: { base_url: 'https://comms.egosms.co/api/v1/json' },
      fields: [
        { key: 'username', label: 'Username', type: 'text', required: true },
        { key: 'password', label: 'API Key / Password', type: 'password', required: true },
        { key: 'sender_id', label: 'Default Sender ID', type: 'text', required: true },
        { key: 'base_url', label: 'API Base URL', type: 'text' }
      ]
    },
    {
      provider: 'africas_talking',
      display_name: "Africa's Talking",
      description: 'Bulk SMS across African markets',
      supported: false,
      defaults: { api_base: 'https://api.africastalking.com' },
      fields: [
        { key: 'username', label: 'Username', type: 'text', required: true },
        { key: 'api_key', label: 'API Key', type: 'password', required: true },
        { key: 'sender_id', label: 'Sender ID', type: 'text', required: true }
      ]
    },
    {
      provider: 'twilio',
      display_name: 'Twilio',
      description: 'Global SMS and messaging API',
      supported: false,
      defaults: { api_base: 'https://api.twilio.com' },
      fields: [
        { key: 'account_sid', label: 'Account SID', type: 'text', required: true },
        { key: 'auth_token', label: 'Auth Token', type: 'password', required: true },
        { key: 'sender_id', label: 'From Number / Sender ID', type: 'text', required: true }
      ]
    },
    {
      provider: 'vonage',
      display_name: 'Vonage (Nexmo)',
      description: 'SMS API with global reach',
      supported: false,
      fields: [
        { key: 'api_key', label: 'API Key', type: 'text', required: true },
        { key: 'api_secret', label: 'API Secret', type: 'password', required: true },
        { key: 'sender_id', label: 'Sender ID', type: 'text', required: true }
      ]
    },
    {
      provider: 'termii',
      display_name: 'Termii',
      description: 'SMS for Nigeria and African markets',
      supported: false,
      defaults: { api_base: 'https://api.ng.termii.com' },
      fields: [
        { key: 'api_key', label: 'API Key', type: 'password', required: true },
        { key: 'sender_id', label: 'Sender ID', type: 'text', required: true },
        { key: 'api_base', label: 'API Base URL', type: 'text' }
      ]
    },
    {
      provider: 'messagebird',
      display_name: 'MessageBird',
      description: 'SMS, voice, and omnichannel messaging',
      supported: false,
      fields: [
        { key: 'access_key', label: 'Access Key', type: 'password', required: true },
        { key: 'originator', label: 'Originator / Sender', type: 'text', required: true }
      ]
    }
  ],
  email: [
    {
      provider: 'smtp',
      display_name: 'Gmail / Custom SMTP',
      description: 'Gmail, Outlook, cPanel, or any SMTP server',
      supported: true,
      defaults: { smtp_port: '587', smtp_secure: 'false' },
      fields: [
        { key: 'smtp_host', label: 'SMTP Host', type: 'text', required: true },
        { key: 'smtp_port', label: 'SMTP Port', type: 'text', required: true },
        { key: 'smtp_user', label: 'SMTP Username', type: 'text', required: true },
        { key: 'smtp_pass', label: 'SMTP Password / App Password', type: 'password', required: true },
        { key: 'smtp_from', label: 'From Address', type: 'text', required: true },
        { key: 'smtp_secure', label: 'Use TLS/SSL (true / false)', type: 'text' }
      ]
    },
    {
      provider: 'sendgrid',
      display_name: 'SendGrid',
      description: 'Transactional email via SendGrid SMTP/API',
      supported: false,
      fields: [
        { key: 'api_key', label: 'API Key', type: 'password', required: true },
        { key: 'from_email', label: 'From Email', type: 'text', required: true },
        { key: 'from_name', label: 'From Name', type: 'text' }
      ]
    },
    {
      provider: 'mailgun',
      display_name: 'Mailgun',
      description: 'Email API for developers',
      supported: false,
      fields: [
        { key: 'api_key', label: 'API Key', type: 'password', required: true },
        { key: 'domain', label: 'Sending Domain', type: 'text', required: true },
        { key: 'from_email', label: 'From Email', type: 'text', required: true }
      ]
    },
    {
      provider: 'amazon_ses',
      display_name: 'Amazon SES',
      description: 'Scalable email via AWS Simple Email Service',
      supported: false,
      defaults: { region: 'eu-west-1' },
      fields: [
        { key: 'access_key', label: 'AWS Access Key ID', type: 'text', required: true },
        { key: 'secret_key', label: 'AWS Secret Access Key', type: 'password', required: true },
        { key: 'region', label: 'AWS Region', type: 'text', required: true },
        { key: 'from_email', label: 'From Email', type: 'text', required: true }
      ]
    },
    {
      provider: 'postmark',
      display_name: 'Postmark',
      description: 'Fast transactional email delivery',
      supported: false,
      fields: [
        { key: 'server_token', label: 'Server Token', type: 'password', required: true },
        { key: 'from_email', label: 'From Email', type: 'text', required: true }
      ]
    },
    {
      provider: 'mailjet',
      display_name: 'Mailjet',
      description: 'Email service with API and SMTP',
      supported: false,
      fields: [
        { key: 'api_key', label: 'API Key', type: 'text', required: true },
        { key: 'secret_key', label: 'Secret Key', type: 'password', required: true },
        { key: 'from_email', label: 'From Email', type: 'text', required: true },
        { key: 'from_name', label: 'From Name', type: 'text' }
      ]
    }
  ]
};

function listTemplates(category = null) {
  if (!category) return GATEWAY_TEMPLATES;
  return GATEWAY_TEMPLATES[category] || [];
}

function getTemplate(category, provider) {
  return (GATEWAY_TEMPLATES[category] || []).find(item => item.provider === provider) || null;
}

function defaultConfig(category, provider) {
  const template = getTemplate(category, provider);
  if (!template) return {};
  return { ...(template.defaults || {}) };
}

module.exports = { GATEWAY_TEMPLATES, listTemplates, getTemplate, defaultConfig };
