import subprocess
import json

def get_balance():
    try:
        result = subprocess.run(['onchainos', 'wallet', 'balance', '--all'], capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        if not data.get('ok'):
            print(f"Error: {data.get('message', 'Unknown error')}")
            return
            
        print(f"Total Portfolio Value: ${data['data'].get('totalValueUsd', '0.00')}")
        print("-" * 30)
        
        details = data['data'].get('details', {})
        for account_id, account_info in details.items():
            print(f"Account: {account_info.get('accountName', account_id)}")
            print(f"  EVM Address: {account_info.get('evmAddress', 'N/A')}")
            print(f"  SOL Address: {account_info.get('solAddress', 'N/A')}")
            print(f"  Total Value: ${account_info.get('totalValueUsd', '0.00')}")
            
            chains = account_info.get('chains', [])
            if chains:
                print("  Assets by Chain:")
                for chain in chains:
                    if float(chain.get('totalValueUsd', 0)) > 0:
                        print(f"    - {chain.get('chainName')}: ${chain.get('totalValueUsd')}")
            print("-" * 30)
            
    except Exception as e:
        print(f"Error: {str(e)}")

if __name__ == "__main__":
    get_balance()
