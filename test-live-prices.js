import dotenv from 'dotenv';
import { 
  fetchAllPrices,
  fetchGoldPriceUSD,
  fetchSilverPriceUSD,
  fetchDollarRatePKR,
  fetchRiyalRatePKR,
  fetchDirhamRatePKR,
  calculatePricePerTola
} from './utils/goldpriceCalculator.js';

dotenv.config();

const testAllPrices = async () => {
  console.log('\n🚀 GOLD, SILVER & CURRENCY PRICE TEST\n');
  console.log('=' .repeat(60));
  
  try {
    // Test 1: Fetch all prices together
    console.log('\n📊 FETCHING ALL LIVE PRICES:\n');
    const allPrices = await fetchAllPrices();
    
    console.log('\n💰 PRECIOUS METALS:');
    console.log('-'.repeat(60));
    console.log(`🥇 GOLD Price:      $${allPrices.gold.priceUSD.toFixed(2)} per ounce`);
    console.log(`🥇 GOLD Price:      ${allPrices.gold.pricePerTolaPKR.toFixed(2)} PKR per Tola`);
    console.log('');
    console.log(`🥈 SILVER Price:    $${allPrices.silver.priceUSD.toFixed(2)} per ounce`);
    console.log(`🥈 SILVER Price:    ${allPrices.silver.pricePerTolaPKR.toFixed(2)} PKR per Tola`);
    
    console.log('\n💱 CURRENCY RATES (1 Unit = PKR):');
    console.log('-'.repeat(60));
    console.log(`💵 US Dollar (USD):  ${allPrices.currencies.USD.rate.toFixed(2)} PKR`);
    console.log(`🇸🇦 Saudi Riyal (SAR): ${allPrices.currencies.SAR.rate.toFixed(2)} PKR`);
    console.log(`🇦🇪 UAE Dirham (AED): ${allPrices.currencies.AED.rate.toFixed(2)} PKR`);
    
    console.log('\n🕐 Last Updated:');
    console.log('-'.repeat(60));
    console.log(`📅 ${allPrices.timestamp.toLocaleString()}`);
    
    // Test 2: Individual API tests
    console.log('\n\n📊 INDIVIDUAL API TESTS:\n');
    console.log('=' .repeat(60));
    
    console.log('\n🥇 GOLD API:');
    const gold = await fetchGoldPriceUSD();
    console.log(`   Gold Price: $${gold.toFixed(2)}/ounce`);
    
    console.log('\n🥈 SILVER API:');
    const silver = await fetchSilverPriceUSD();
    console.log(`   Silver Price: $${silver.toFixed(2)}/ounce`);
    
    console.log('\n💵 DOLLAR API:');
    const dollar = await fetchDollarRatePKR();
    console.log(`   1 USD = ${dollar.toFixed(2)} PKR`);
    
    console.log('\n🇸🇦 RIYAL API:');
    const riyal = await fetchRiyalRatePKR();
    console.log(`   1 SAR = ${riyal.toFixed(2)} PKR`);
    
    console.log('\n🇦🇪 DIRHAM API:');
    const dirham = await fetchDirhamRatePKR();
    console.log(`   1 AED = ${dirham.toFixed(2)} PKR`);
    
    // Test 3: Price calculations with differences
    console.log('\n\n📊 PRICE CALCULATIONS WITH LOCAL MARKET DIFFERENCE:\n');
    console.log('=' .repeat(60));
    
    const differences = [
      { label: 'Market Price (No Difference)', value: 0 },
      { label: 'Local Market (+500 PKR)', value: 500 },
      { label: 'Local Market (+1000 PKR)', value: 1000 },
      { label: 'Local Market (+5000 PKR)', value: 5000 },
      { label: 'Local Market (-200 PKR)', value: -200 }
    ];
    
    console.log('\n🥇 GOLD PRICE (PKR per Tola):');
    console.log('-'.repeat(60));
    differences.forEach(diff => {
      const finalPrice = allPrices.gold.pricePerTolaPKR + diff.value;
      console.log(`${diff.label.padEnd(30)}: ${finalPrice.toFixed(2)} PKR`);
    });
    
    console.log('\n🥈 SILVER PRICE (PKR per Tola):');
    console.log('-'.repeat(60));
    differences.forEach(diff => {
      const finalPrice = allPrices.silver.pricePerTolaPKR + diff.value;
      console.log(`${diff.label.padEnd(30)}: ${finalPrice.toFixed(2)} PKR`);
    });
    
    console.log('\n💱 CURRENCY RATES WITH DIFFERENCE (PKR):');
    console.log('-'.repeat(60));
    
    console.log('\n💵 US Dollar (USD):');
    differences.forEach(diff => {
      const finalRate = allPrices.currencies.USD.rate + diff.value;
      console.log(`${diff.label.padEnd(30)}: ${finalRate.toFixed(2)} PKR`);
    });
    
    console.log('\n🇸🇦 Saudi Riyal (SAR):');
    differences.forEach(diff => {
      const finalRate = allPrices.currencies.SAR.rate + diff.value;
      console.log(`${diff.label.padEnd(30)}: ${finalRate.toFixed(2)} PKR`);
    });
    
    console.log('\n🇦🇪 UAE Dirham (AED):');
    differences.forEach(diff => {
      const finalRate = allPrices.currencies.AED.rate + diff.value;
      console.log(`${diff.label.padEnd(30)}: ${finalRate.toFixed(2)} PKR`);
    });
    
    console.log('\n\n✅ ALL TESTS COMPLETED SUCCESSFULLY!');
    console.log('=' .repeat(60));
    console.log('\n💡 Tip: Use these values in your Super Admin dashboard\n');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.log('\n💡 Troubleshooting:');
    console.log('  1. Check your internet connection');
    console.log('  2. Verify APIs are accessible');
    console.log('  3. Try again in a few moments\n');
  }
};

// Run the test
testAllPrices();