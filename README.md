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
Cart total: $145.00  
Best coupon: TAKE15  
Savings: $15.00  
Final price: $130.00  

Upsell suggestion:  
Add $13.00 more to unlock TAKE20 and save $20.00 instead  

## Running Locally

```bash
npm install
npm run dev

Best coupon is selected based on maximum savings:

What I Learned
- Designing reusable business logic
- Handling edge cases in pricing systems
- Writing unit tests for real-world scenarios
- Structuring a React + TypeScript project
