import type { UserData } from '../types/UserData'

function gaussianRandom(): number {
  let u = 0, v = 0;
  while(u === 0) u = Math.random();
  v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function runSimulation(userData: UserData): {probability: number, median: number[], downside: number[], years: number[]} {
  const currentYear = new Date().getFullYear()
  const yearsToRetire = userData.retirementAge - userData.currentAge
  const retirementYear = currentYear + yearsToRetire
  const totalYears = userData.lifeExpectancy - userData.currentAge + 1
  const realReturns: Record<string, number> = {conservative: 0.03, moderate: 0.045, high: 0.06}
  const vols: Record<string, number> = {conservative: 0.05, moderate: 0.10, high: 0.15}
  const mean = realReturns[userData.riskLevel]
  const sigma = vols[userData.riskLevel]
  const numSims = 5000
  let successCount = 0
  const portfolioPaths: number[][] = []
  for(let sim = 0; sim < numSims; sim++){
    let balance = userData.currentSavings
    const path: number[] = []
    let failed = false
    for(let i = 0; i < totalYears; i++){
      const year = currentYear + i
      const r = mean + sigma * gaussianRandom()
      balance *= (1 + r)
      if(year < retirementYear){
        balance += userData.annualSavings
      }else{
        const netOutflow = userData.monthlyRetirementSpending * 12 - userData.ssAmount
        if(balance < netOutflow){
          failed = true
        }
        balance -= netOutflow
        if(balance < 0) balance = 0
      }
      path.push(balance)
    }
    portfolioPaths.push(path)
    if(!failed) successCount++
  }
  const probability = Math.round((successCount / numSims) * 100)
  const sortedPaths = Array.from({length: totalYears}, (_, i) =>
    portfolioPaths.map(path => path[i]).sort((a, b) => a - b)
  )
  const median = sortedPaths.map(s => s[Math.floor(numSims / 2)])
  const downside = sortedPaths.map(s => s[Math.floor(numSims * 0.1)])
  const years = Array.from({length: totalYears}, (_, i) => currentYear + i)
  return {probability, median, downside, years}
}