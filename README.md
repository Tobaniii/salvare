## Preview

![App Screenshot](./src/assets/screenshot.png)

# Salvare – Coupon Optimization App

Salvare is a React + TypeScript application that finds the best coupon for a shopping cart based on real-world constraints such as category restrictions, minimum spend, and sale exclusions.

## Features

- 🛒 Cart simulation with multiple items
- 🎟️ Evaluates multiple coupon types:
  - Percentage discounts
  - Fixed discounts
  - Free shipping
- 🧠 Automatically selects the best coupon
- 📊 Compares alternative coupons
- 🚀 Upsell suggestions (e.g. “Add $13 more to unlock a better deal”)
- ✅ Fully tested business logic using Vitest

## Tech Stack

- React
- TypeScript
- Vite
- Vitest (unit testing)

## Example
Best coupon is selected based on maximum savings:

What I Learned
- Designing reusable business logic
- Handling edge cases in pricing systems
- Writing unit tests for real-world scenarios
- Structuring a React + TypeScript project 

Upsell suggestion:  
Add $13.00 more to unlock TAKE20 and save $20.00 instead  

*CURRENT STATUS* - Salvare now works on:

Local test checkout
Shopify dev checkout
WooCommerce local checkout

Shopify: tested on dev checkout
WooCommerce: tested on LocalWP checkout

Candidate coupon codes are still profile-based/hardcoded.
No backend coupon discovery yet.
Store support depends on selectors and checkout structure.

```bash
npm install
npm run dev

Best coupon is selected based on maximum savings:

What I Learned
- Designing reusable business logic
- Handling edge cases in pricing systems
- Writing unit tests for real-world scenarios
- Structuring a React + TypeScript project
