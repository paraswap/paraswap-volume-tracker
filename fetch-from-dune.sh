source .env

# Set the base URL
# epoch 020 - 51 = 4129987 # CSV=true bash fetch-from-dune.sh > 020-51-sorted.csv
# epoch 021 - 52 = 4132184 # CSV=true bash fetch-from-dune.sh > 021-52-sorted.csv
# epoch 022 - 53 = 4221949 # CSV=true bash fetch-from-dune.sh > 022-53-sorted.csv
# epoch 023 - 54 = 4343822 # CSV=true bash fetch-from-dune.sh > 023-54-sorted.csv
# epoch 024 - 55 = 4476980 # CSV=true bash fetch-from-dune.sh > 024-55-sorted.csv
# epoch 025 - 56 = 4614913 # CSV=true bash fetch-from-dune.sh > 025-56-sorted.csv
# epoch 026 - 57 = 4733879 # CSV=true bash fetch-from-dune.sh > 026-57-sorted.csv
# epoch 027 - 58 = 4874764 # CSV=true bash fetch-from-dune.sh > 027-58-sorted.csv
# epoch 028 - 59 = 4988221 # CSV=true bash fetch-from-dune.sh > 028-59-sorted.csv
BASE_URL="https://api.dune.com/api/v1/query/4988221/results"

# Check if CSV is set to true and modify the URL if necessary
if [ "$CSV" = "true" ]; then
  BASE_URL="${BASE_URL}/csv"
  curl --request GET \
    --url "$BASE_URL" \
    -H 'content-type: application/json' \
    -H "X-Dune-Api-Key: $DUNE_API_KEY"
else
  curl --request GET \
    --url "$BASE_URL" \
    -H 'content-type: application/json' \
    -H "X-Dune-Api-Key: $DUNE_API_KEY" 
fi