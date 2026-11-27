export const PRICING_FAQS = [
  {
    question: 'What counts as a paid member?',
    answer:
      'Every full workspace member on Team uses a paid seat. Restricted guests are free and do not add to the Included usage allowance. People who appear in captured work do not become workspace members.',
  },
  {
    question: 'What happens when I add or remove a member?',
    answer:
      'New seats and their Included usage are prorated for the rest of the billing period. Removing a member revokes access immediately. You can reuse the paid seat through the end of the period, and unused seats drop off at renewal.',
  },
  {
    question: 'What happens when Included usage runs out?',
    answer:
      'You can still access existing records. New AI processing and native meeting capture pause until the allowance renews, or until a Team admin enables extra spending within a monthly cap.',
  },
  {
    question: 'How do I cancel or update my payment details?',
    answer:
      'Open Manage payment in Billing to use the payment provider’s customer portal. Check the confirmation for your cancellation date and outstanding charges.',
  },
] as const;
